export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  try {
    const { query, mode } = req.body || {};

    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "Adresse ou annonce manquante" });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY manquante dans Vercel" });
    }

    const prompt = `
Tu es PlaceCheck, un outil français de lecture immobilière.

Analyse : "${query}"
Mode : "${mode || "auto"}"

Sources à chercher quand c'est possible :
1. DVF / data.gouv / Etalab pour les prix de vente réels.
2. Prix de location au m² : SeLoger, MeilleursAgents, observatoires locaux, agences ou données ouvertes si disponibles.
3. DPE si l’entrée est une annonce ou si des données énergie fiables sont accessibles.
4. Qualité de vie : commerces, rues proches, marchés, jardins, équipements, écoles, services, ambiance de quartier.
5. Accessibilité : tram, métro, bus, gares, stations précises et temps piéton si disponible.
6. Sécurité / nuisances / risques : Ville Idéale, Bien dans ma ville, Interstats / ministère de l’Intérieur, GeoRisques, données officielles ou avis habitants.
7. Si c'est une annonce, lire l'annonce seulement si elle est publiquement accessible.
8. Pour une annonce, le DPE est prioritaire : cherche explicitement la lettre DPE (A, B, C, D, E, F ou G).

Règles impératives :
- Ne mets jamais d'URL dans les champs texte. Les URL vont uniquement dans "sources".
- Tous les scores doivent être sur 100.
- Si l’utilisateur donne seulement une adresse, tu n’as pas le droit de juger le prix du bien, puisqu’aucun prix n’a été fourni.
- Pour une adresse seule, "Prix & valeur" doit afficher si possible un prix moyen au m² à l’achat et un prix locatif au m².
- Pour "Prix & valeur", tu dois chercher activement et afficher des ordres de grandeur chiffrés : prix d’achat €/m² et loyer €/m²/mois. Si aucun chiffre fiable n’est trouvé, écris : "Prix achat et loyer non trouvés dans les sources consultées."
- N’écris jamais "prix modérés", "prix cohérent", "bonne affaire" ou "opportunité" sans prix fourni par l’utilisateur.
- Pour "Sécurité & nuisances", ne parle jamais de criminalité faible, de quartier sûr, de bruit ou de nuisances si tu n’as pas une source claire.
- Si aucune source claire n’est trouvée sur sécurité/nuisances, écris exactement : "Aucun signal particulier identifié."
- Pour "Qualité de vie", tu dois citer des agréments concrets du quartier, pas une formule générale.
- Exemple pour Bordeaux Fondaudège : rue Fondaudège, commerces de bouche, cafés, Jardin Public, centre-ville, quartier résidentiel vivant.
- Pour "Accessibilité", tu dois citer des éléments précis : tram, arrêt, bus, gare, distance approximative si disponible.
- Exemple pour Bordeaux : tram D, arrêt Fondaudège-Muséum ou Croix de Seguey si pertinent.
- Si une donnée est absente, dis "à vérifier", sans inventer.
- Phrases courtes. Pas de répétitions entre les champs. Le "verdict", "subtitle" et "summary" doivent être différents. Ne répète jamais exactement le même intitulé.
- Réponds uniquement en JSON valide.

Structure JSON exacte :
{
  "inputType": "Adresse" ou "Annonce" ou "Recherche vague",
  "confidence": "Analyse sourcée" ou "Lecture annonce" ou "Analyse indicative" ou "Adresse partielle",
  "score": nombre entre 0 et 100,
  "verdict": "3 à 5 mots maximum",
  "subtitle": "1 phrase courte",
  "summary": "1 phrase courte différente",
  "fastRead": "1 phrase courte sur le potentiel",
  "checkRead": "3 points maximum à vérifier, séparés par des virgules",
  "categories": {
    "life": nombre entre 0 et 100,
    "lifeText": "phrase courte avec 2 à 4 agréments précis du quartier",
    "price": nombre entre 0 et 100,
    "priceText": "prix d’achat €/m² + loyer €/m²/mois si trouvés ; sinon indiquer clairement que les prix n’ont pas été trouvés",
    "safety": nombre entre 0 et 100,
    "safetyText": "si pas de source claire : Aucun signal particulier identifié.",
    "access": nombre entre 0 et 100,
    "accessText": "phrase courte avec transports ou stations précises",
    "energy": nombre entre 0 et 100,
    "energyText": "phrase courte. Pour une annonce, mentionner le DPE lu ou indiquer qu'il n'a pas été lu"
  },
  "signals": {
    "positive": ["4 signaux maximum, concrets"],
    "negative": ["4 points maximum, uniquement sourcés ou à vérifier"]
  },
  "questions": ["4 questions courtes"],
  "sources": [
    {"domain":"Nom du site ou source","title":"Titre court","url":"URL si disponible"}
  ]
}`;

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        tools: [{ type: "web_search" }],
        input: prompt
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({ error: data.error?.message || "Erreur OpenAI" });
    }

    const text =
      data.output_text ||
      data.output?.flatMap(item => item.content || [])
        ?.find(content => content.type === "output_text" || content.type === "text")?.text ||
      "";

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : null;
    }

    if (!parsed) return res.status(500).json({ error: "Analyse invalide" });

    const clamp = (v) => {
      let n = Number(v ?? 50);
      if (!Number.isFinite(n)) n = 50;
      if (n > 0 && n <= 10) n *= 10;
      return Math.max(0, Math.min(100, Math.round(n)));
    };

    const clean = (v) => String(v ?? "")
      .replace(/\[[^\]]+\]\([^)]+\)/g, "")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/\s+/g, " ")
      .trim();

    const limit = (v, max = 180) => {
      const t = clean(v);
      return t.length > max ? t.slice(0, max).replace(/\s+\S*$/, "") + "…" : t;
    };

    const uniqueList = (arr) => {
      const seen = new Set();
      return arr.filter(item => {
        const key = clean(item).toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };

    parsed.score = clamp(parsed.score);
    parsed.subtitle = limit(parsed.subtitle, 140);
    parsed.summary = limit(parsed.summary, 130);
    parsed.fastRead = limit(parsed.fastRead, 110);
    parsed.checkRead = limit(parsed.checkRead, 120);

    parsed.categories = parsed.categories || {};
    for (const key of ["life", "price", "safety", "access", "energy"]) {
      parsed.categories[key] = clamp(parsed.categories[key]);
      parsed.categories[key + "Text"] = limit(parsed.categories[key + "Text"], 130);
    }

    parsed.signals = parsed.signals || {};
    parsed.signals.positive = Array.isArray(parsed.signals.positive) ? uniqueList(parsed.signals.positive).slice(0, 4).map(item => limit(item, 90)) : [];
    parsed.signals.negative = Array.isArray(parsed.signals.negative) ? uniqueList(parsed.signals.negative).slice(0, 4).map(item => limit(item, 90)) : [];
    parsed.questions = Array.isArray(parsed.questions) ? uniqueList(parsed.questions).slice(0, 4).map(item => limit(item, 110)) : [];
    parsed.sources = Array.isArray(parsed.sources) ? parsed.sources.slice(0, 5).map(s => ({
      domain: clean(s.domain),
      title: clean(s.title),
      url: String(s.url || "").trim()
    })) : [];

    const inputText = String(query || "").toLowerCase();
    const looksLikeListing =
      inputText.includes("http") ||
      inputText.includes("seloger") ||
      inputText.includes("leboncoin") ||
      inputText.includes("bienici") ||
      /\b\d+\s?€|\beuros?\b|\bprix\b/i.test(inputText);

    if (!looksLikeListing) {
      const forbiddenPrice = /(prix globalement cohérent|opportunité évidente|état réel du bien|prix final|prix demandé|bonne affaire|surcoté|trop cher|prix modérés|prix modéré)/i;
      if (forbiddenPrice.test(parsed.categories.priceText || "")) {
        parsed.categories.priceText = "Prix achat et loyer non trouvés dans les sources consultées.";
      }

      if (!/(m²|m2|€)/i.test(parsed.categories.priceText || "") && !/(non trouvés|non trouves|€|m²|m2)/i.test(parsed.categories.priceText || "")) {
        parsed.categories.priceText = "Prix achat et loyer non trouvés dans les sources consultées.";
      }

      const forbiddenNuisance = /(faible taux de criminalité|criminalité faible|quartier sûr|bruit|circulation|animation selon les horaires|nuisances sonores)/i;
      if (forbiddenNuisance.test(parsed.categories.safetyText || "")) {
        parsed.categories.safetyText = "Aucun signal particulier identifié.";
      }

      parsed.signals.negative = parsed.signals.negative.filter(item => !forbiddenNuisance.test(item));
      parsed.checkRead = parsed.checkRead
        .replace(/Bruit réel,?\s*/gi, "")
        .replace(/nuisances?[^,.;]*/gi, "")
        .replace(/prix final[^,.;]*/gi, "")
        .replace(/prix demandé[^,.;]*/gi, "")
        .replace(/^,\s*/, "")
        .trim();

      if (!parsed.checkRead || parsed.checkRead.length < 10) {
        parsed.checkRead = "DPE, état de l’immeuble, charges, luminosité.";
      }
    }

    if (!parsed.categories.safetyText || /(donnée à vérifier|à vérifier)$/i.test(parsed.categories.safetyText)) {
      parsed.categories.safetyText = "Aucun signal particulier identifié.";
    }

    const inputIsBordeauxFondaudege =
      /fourcand|fondaud[eè]ge|jardin public|croix de seguey|mus[eé]um/i.test(inputText) &&
      /bordeaux|33000/i.test(inputText);

    if (inputIsBordeauxFondaudege) {
      if (!/fondaud|jardin public|mus[eé]um|croix de seguey|tram d/i.test(parsed.categories.lifeText || "")) {
        parsed.categories.lifeText = "Rue Fondaudège, commerces de proximité, cafés, Jardin Public et centre-ville accessibles.";
      }
      if (!/tram|fondaud|mus[eé]um|croix de seguey/i.test(parsed.categories.accessText || "")) {
        parsed.categories.accessText = "Tram D à proximité, notamment Fondaudège-Muséum ou Croix de Seguey selon l’adresse exacte.";
      }
    }


    if (!looksLikeListing) {
      const noPriceNumbers = !/(\d[\d\s.,]*\s*€|\d[\d\s.,]*\s*\/\s*m²|\d[\d\s.,]*\s*\/\s*m2)/i.test(parsed.categories.priceText || "");
      if (noPriceNumbers) {
        parsed.categories.price = Math.min(parsed.categories.price, 50);
      }
    }

    const dpeMatch = inputText.match(/\bdpe\s*[:\-]?\s*([abcdefg])\b/i);
    if (looksLikeListing && dpeMatch) {
      const dpe = dpeMatch[1].toUpperCase();
      const dpeScores = { A: 92, B: 82, C: 70, D: 58, E: 42, F: 25, G: 12 };
      parsed.categories.energy = dpeScores[dpe] || parsed.categories.energy;
      parsed.categories.energyText = `DPE ${dpe} indiqué dans l’annonce ; impact à intégrer dans les charges, le confort et la négociation.`;
    } else if (looksLikeListing && !/dpe/i.test(parsed.categories.energyText || "")) {
      parsed.categories.energy = Math.min(parsed.categories.energy, 50);
      parsed.categories.energyText = "DPE non lu : collez le texte de l’annonce pour l’analyser.";
    }

    return res.status(200).json(parsed);
  } catch (error) {
    return res.status(500).json({ error: error.message || "Erreur serveur" });
  }
}
