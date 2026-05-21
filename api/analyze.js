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

Objectif : produire une lecture utile, sobre et nuancée d'une adresse ou d'une annonce immobilière.

Sources à chercher quand c'est possible :
1. DVF / data.gouv / Etalab pour les prix de vente réels.
2. Données DPE si accessibles.
3. Transports, commerces, services, contexte urbain.
4. Risques, nuisances, bruit, pollution si accessible.
5. Si c'est une annonce, lire l'annonce seulement si elle est publiquement accessible.
6. Pour une annonce, le DPE est prioritaire : cherche explicitement la lettre DPE (A, B, C, D, E, F ou G) dans la page ou dans le texte fourni.

Règles impératives :
- Ne mets JAMAIS d'URL dans les champs texte.
- Les URL vont uniquement dans le tableau "sources".
- Ne cite pas de site entre parenthèses dans les textes.
- Tous les scores doivent être sur 100, jamais sur 10.
- Si tu hésites entre 7/10 et 70/100, tu dois écrire 70.
- Pas de carte, pas de comparable détaillé.
- Ne prétends pas avoir utilisé DVF si tu ne l'as pas réellement trouvé.
- Si la donnée est absente, dis "à vérifier", sans inventer.
- Ne mentionne jamais des nuisances sonores, de l’insécurité ou du bruit si tu n’as pas trouvé d’information sourcée ou si l’utilisateur ne l’a pas indiqué.
- Si tu n’as pas d’information sur les nuisances, écris plutôt : "Rue et nuisances à confirmer sur place." 
- Style français, sobre, éditorial, phrases très courtes.
- Évite absolument les répétitions : chaque champ doit apporter une information différente.
- "verdict", "subtitle", "summary", "fastRead" et "checkRead" ne doivent pas répéter la même idée.
- "checkRead" doit contenir 3 points maximum, séparés par des virgules, pas un paragraphe.
- Si une donnée est absente, écris simplement "Donnée à vérifier", pas une longue explication.
- Réponds uniquement avec un JSON valide, sans markdown.

Structure JSON exacte :
{
  "inputType": "Adresse" ou "Annonce" ou "Recherche vague",
  "confidence": "Analyse sourcée" ou "Lecture annonce" ou "Analyse indicative" ou "Adresse partielle",
  "score": nombre entre 0 et 100,
  "verdict": "3 à 5 mots maximum",
  "subtitle": "1 phrase courte, différente du verdict, sans URL",
  "summary": "1 phrase courte, différente du subtitle, sans URL",
  "fastRead": "1 phrase courte sur le potentiel, sans URL",
  "checkRead": "3 points maximum à vérifier, séparés par des virgules, sans URL",
  "categories": {
    "life": nombre entre 0 et 100,
    "lifeText": "phrase courte, sans URL",
    "price": nombre entre 0 et 100,
    "priceText": "phrase courte, sans URL. Si simple adresse sans prix : contexte de marché uniquement, pas de jugement sur un prix",
    "safety": nombre entre 0 et 100,
    "safetyText": "phrase courte, sans URL. Ne jamais inventer de bruit ou nuisance",
    "access": nombre entre 0 et 100,
    "accessText": "phrase courte, sans URL",
    "energy": nombre entre 0 et 100,
    "energyText": "phrase courte, sans URL. Pour une annonce, mentionne explicitement le DPE lu ou indique qu’il n’a pas été lu"
  },
  "signals": {
    "positive": ["4 signaux maximum, courts, sans URL"],
    "negative": ["4 points maximum, courts, sans URL. Ne pas inventer bruit/nuisance/sécurité"]
  },
  "placecheckTake": "2 phrases maximum, sans URL",
  "questions": ["4 questions courtes, sans URL"],
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
      return res.status(500).json({
        error: data.error?.message || "Erreur OpenAI"
      });
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

    if (!parsed) {
      return res.status(500).json({ error: "Analyse invalide" });
    }

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
    parsed.placecheckTake = limit(parsed.placecheckTake, 240);

    parsed.categories = parsed.categories || {};
    for (const key of ["life", "price", "safety", "access", "energy"]) {
      parsed.categories[key] = clamp(parsed.categories[key]);
      parsed.categories[key + "Text"] = limit(parsed.categories[key + "Text"], 130);
    }

    parsed.signals = parsed.signals || {};
    parsed.signals.positive = Array.isArray(parsed.signals.positive)
      ? uniqueList(parsed.signals.positive).slice(0, 4).map(item => limit(item, 90))
      : [];
    parsed.signals.negative = Array.isArray(parsed.signals.negative)
      ? uniqueList(parsed.signals.negative).slice(0, 4).map(item => limit(item, 90))
      : [];

    parsed.questions = Array.isArray(parsed.questions)
      ? uniqueList(parsed.questions).slice(0, 4).map(item => limit(item, 110))
      : [];

    parsed.sources = Array.isArray(parsed.sources)
      ? parsed.sources.slice(0, 5).map(s => ({
          domain: clean(s.domain),
          title: clean(s.title),
          url: String(s.url || "").trim()
        }))
      : [];


    const inputText = String(query || "").toLowerCase();
    const looksLikeListing =
      inputText.includes("http") ||
      inputText.includes("seloger") ||
      inputText.includes("leboncoin") ||
      inputText.includes("bienici") ||
      /\b\d+\s?€|\beuros?\b|\bprix\b/i.test(inputText);

    if (!looksLikeListing) {
      parsed.categories.priceText = parsed.categories.priceText
        .replace(/prix (est|semble|reste|demandé)[^.]*\./gi, "")
        .replace(/(cohérent|surcoté|sous-coté|opportunité|bonne affaire|trop cher|cher pour le secteur)/gi, "à étudier")
        .trim();

      if (!parsed.categories.priceText || parsed.categories.priceText.length < 20) {
        parsed.categories.priceText = "Contexte de marché à documenter avec DVF et les transactions récentes du secteur.";
      }

      parsed.checkRead = parsed.checkRead
        .replace(/prix final[^,.;]*/gi, "prix si annonce disponible")
        .replace(/prix demandé[^,.;]*/gi, "prix si annonce disponible");
    }


    const dpeMatch = inputText.match(/\bdpe\s*[:\-]?\s*([abcdefg])\b/i);
    if (looksLikeListing && dpeMatch) {
      const dpe = dpeMatch[1].toUpperCase();
      const dpeScores = { A: 92, B: 82, C: 70, D: 58, E: 42, F: 25, G: 12 };
      parsed.categories.energy = dpeScores[dpe] || parsed.categories.energy;
      parsed.categories.energyText = `DPE ${dpe} indiqué dans l’annonce ; impact à intégrer dans les charges, le confort et la négociation.`;
      parsed.signals.negative = parsed.signals.negative.filter(item => !/dpe non lu|performance énergétique/i.test(item));
      if (["F", "G"].includes(dpe)) {
        parsed.signals.negative.unshift(`DPE ${dpe} : point énergétique prioritaire.`);
      }
    } else if (looksLikeListing) {
      parsed.categories.energy = Math.min(parsed.categories.energy, 50);
      if (!/dpe/i.test(parsed.categories.energyText)) {
        parsed.categories.energyText = "DPE non lu : collez le texte de l’annonce pour l’analyser.";
      }
    }


    const nuisanceWords = /(bruit|nuisance|sonore|insécurité|sécurité faible|circulation bruyante)/i;
    const hasNuisanceSource = parsed.sources.some(s => nuisanceWords.test(`${s.domain} ${s.title}`));
    const userMentionsNuisance = nuisanceWords.test(inputText);

    if (!hasNuisanceSource && !userMentionsNuisance) {
      parsed.categories.safetyText = "Rue et nuisances à confirmer sur place ; aucun signal spécifique retenu.";
      parsed.signals.negative = parsed.signals.negative.filter(item => !nuisanceWords.test(item));
    }


    return res.status(200).json(parsed);
  } catch (error) {
    return res.status(500).json({ error: error.message || "Erreur serveur" });
  }
}
