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

    let dvfData = null;

    try {
      const protocol = req.headers["x-forwarded-proto"] || "https";
      const host = req.headers.host;
      const baseUrl = `${protocol}://${host}`;

      const dvfRes = await fetch(
        `${baseUrl}/api/dvf?address=${encodeURIComponent(query)}`
      );

      dvfData = await dvfRes.json();
    } catch {
      dvfData = null;
    }

    const dvfContext =
      dvfData && dvfData.averagePriceM2
        ? `
Données DVF réelles trouvées autour de l’adresse :
- prix moyen observé : ${dvfData.averagePriceM2} €/m²
- prix bas observé : ${dvfData.minPriceM2} €/m²
- prix haut observé : ${dvfData.maxPriceM2} €/m²
- nombre de transactions retenues : ${dvfData.transactionsCount}
- source : ${dvfData.source || "DVF"}
`
        : `
Aucune donnée DVF fiable trouvée autour de l’adresse.
Ne donne pas de prix d’achat inventé.
`;

    const prompt = `
Tu es PlaceCheck, un outil français de lecture immobilière.

Analyse : "${query}"
Mode : "${mode || "auto"}"

${dvfContext}

Règles impératives :
- Ne mets jamais d'URL dans les champs texte. Les URL vont uniquement dans "sources".
- Tous les scores doivent être sur 100.
- Si l’utilisateur donne seulement une adresse, tu n’as pas le droit de juger le prix du bien.
- Pour "Prix & valeur", utilise d’abord les données DVF fournies ci-dessus.
- Si les données DVF sont absentes, écris : "Prix DVF non trouvé autour de cette adresse."
- N’écris jamais "prix modérés", "prix cohérent", "bonne affaire" ou "opportunité" sans donnée chiffrée.
- Pour "Sécurité & nuisances", ne parle jamais de criminalité faible, de quartier sûr, de bruit ou de nuisances si tu n’as pas une source claire.
- Si aucune source claire n’est trouvée sur sécurité/nuisances, écris exactement : "Aucun signal particulier identifié."
- Pour "Qualité de vie", cite des agréments concrets du quartier : rues voisines, commerces, jardins, cafés, services.
- Pour "Accessibilité", cite des éléments précis : tram, arrêt, bus, gare, distance approximative si disponible.
- Pour une adresse seule, tu n’as pas le droit d’inventer un DPE.
- Si aucun DPE explicite n’est trouvé, écris exactement : "DPE non trouvé pour cette adresse seule."
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
    "lifeText": "phrase courte avec 2 à 4 agréments précis du quartier",
    "price": nombre entre 0 et 100,
    "priceText": "prix DVF €/m² si disponible ; sinon indiquer clairement que DVF n’a rien trouvé",
    "safety": nombre entre 0 et 100,
    "safetyText": "si pas de source claire : Aucun signal particulier identifié.",
    "access": nombre entre 0 et 100,
    "accessText": "phrase courte avec transports ou stations précises",
    "energy": nombre entre 0 et 100,
    "energyText": "DPE uniquement si explicitement trouvé"
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

    if (!parsed) {
      return res.status(500).json({ error: "Analyse invalide" });
    }

    if (dvfData && dvfData.averagePriceM2) {
      parsed.categories.priceText =
        `DVF autour de l’adresse : moyenne ${dvfData.averagePriceM2} €/m², fourchette ${dvfData.minPriceM2}–${dvfData.maxPriceM2} €/m², ${dvfData.transactionsCount} transactions retenues.`;

      parsed.sources = parsed.sources || [];
      parsed.sources.unshift({
        domain: "DVF",
        title: "Données foncières autour de l’adresse",
        url: ""
      });
    } else {
      parsed.categories.priceText = "Prix DVF non trouvé autour de cette adresse.";
      parsed.categories.price = Math.min(Number(parsed.categories.price || 50), 50);
    }

    return res.status(200).json(parsed);
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Erreur serveur"
    });
  }
}
