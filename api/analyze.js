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
2. Données DPE si accessibles.
3. Transports, commerces, services, contexte urbain.
4. Risques, nuisances, bruit, pollution si accessible.
5. Si c'est une annonce, lire l'annonce seulement si elle est publiquement accessible.
6. Pour une annonce, le DPE est prioritaire : cherche explicitement la lettre DPE (A, B, C, D, E, F ou G).

Règles impératives :
- Ne mets jamais d'URL dans les champs texte. Les URL vont uniquement dans "sources".
- Tous les scores doivent être sur 100.
- Si l’utilisateur donne seulement une adresse, tu n’as pas le droit de juger le prix du bien, puisqu’aucun prix n’a été fourni.
- Pour une adresse seule, "Prix & valeur" parle seulement du contexte de marché local, jamais de "prix cohérent", "opportunité", "surcoté", "prix demandé" ou "état réel du bien".
- Pour une adresse seule, ne parle pas de bruit, circulation, nuisances ou animation nocturne si tu n’as pas une source claire.
- Pour "Qualité de vie", donne des points précis du quartier : rues voisines, commerces, tram, jardin, équipements, services, si disponibles.
- Si une donnée est absente, dis "à vérifier", sans inventer.
- Phrases courtes. Pas de répétitions entre les champs.
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
    "lifeText": "phrase courte avec 2 à 4 points précis du quartier si disponibles",
    "price": nombre entre 0 et 100,
    "priceText": "phrase courte. Si adresse seule : contexte de marché uniquement",
    "safety": nombre entre 0 et 100,
    "safetyText": "phrase courte. Ne jamais inventer de bruit ou nuisance",
    "access": nombre entre 0 et 100,
    "accessText": "phrase courte",
    "energy": nombre entre 0 et 100,
    "energyText": "phrase courte. Pour une annonce, mentionner le DPE lu ou indiquer qu'il n'a pas été lu"
  },
  "signals": {
    "positive": ["4 signaux maximum"],
    "negative": ["4 points maximum"]
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
      const forbiddenPrice = /(prix globalement cohérent|opportunité évidente|état réel du bien|prix final|prix demandé|bonne affaire|surcoté|trop cher)/i;
      if (forbiddenPrice.test(parsed.categories.priceText || "")) {
        parsed.categories.priceText = "Marché local à documenter avec DVF ; aucun prix de bien n’a été fourni.";
      }

      const forbiddenNuisance = /(bruit|circulation|animation selon les horaires|nuisances sonores)/i;
      if (forbiddenNuisance.test(parsed.categories.safetyText || "")) {
        parsed.categories.safetyText = "Aucun signal spécifique retenu ; calme et environnement à confirmer par une visite.";
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
