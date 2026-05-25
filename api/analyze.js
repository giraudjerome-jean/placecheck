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
      return res.status(500).json({ error: "OPENAI_API_KEY manquante" });
    }

    // -----------------------------
    // DVF BLOCK
    // -----------------------------

    let dvfBlock = "";

    try {
      const origin =
        req.headers.origin ||
        "https://placecheck.vercel.app";

      const dvfRes = await fetch(
        `${origin}/api/dvf?address=${encodeURIComponent(query)}`
      );

      if (dvfRes.ok) {
        const dvf = await dvfRes.json();

        if (dvf.transactionsCount > 0) {
          dvfBlock = `
DVF réel autour de l'adresse :

- ${dvf.transactionsCount} transactions comparables
- prix moyen : ${dvf.averagePriceM2} €/m²
- médiane : ${dvf.medianPriceM2} €/m²
- fourchette : ${dvf.minPriceM2} à ${dvf.maxPriceM2} €/m²
- rayon analysé : ${dvf.radius} m
`;
        }
      }
    } catch (e) {
      console.log("DVF fetch failed");
    }

    // -----------------------------
    // PROMPT
    // -----------------------------

    const prompt = `
${dvfBlock}

Tu es PlaceCheck, un outil français de lecture immobilière.

Analyse :
"${query}"

Mode :
"${mode || "auto"}"

Données autorisées :
1. Pour le prix, utiliser uniquement le bloc DVF réel fourni ci-dessus.
2. Ne jamais utiliser MeilleursAgents, SeLoger, Bien'ici, Efficity ou autres estimateurs privés.
3. Si le bloc DVF est vide, écrire exactement :
"Données DVF non disponibles pour cette adresse."
4. Pour une adresse seule, ne pas inventer de DPE.
5. Pour une adresse seule, écrire :
"DPE non disponible sans annonce ou diagnostic."
6. Pour la qualité de vie et l’accessibilité, rester factuel et concret.

Règles impératives :
- Ne jamais citer DVF dans le texte final.
- Dans priceText, écrire :
prix moyen observé, fourchette locale, nombre de ventes comparables et rayon analysé.
- Ne mets jamais d'URL dans les champs texte.
- Tous les scores doivent être sur 100.
- Pas de phrases vagues du type "quartier attractif".
- Réponds uniquement en JSON valide.

Structure JSON exacte :

{
  "inputType": "Adresse",
  "confidence": "Analyse sourcée",
  "score": 75,
  "verdict": "Bonne adresse",
  "subtitle": "Phrase courte",
  "summary": "Phrase courte",
  "categories": {
    "price": 75,
    "priceText": "Texte",
    "life": 80,
    "lifeText": "Texte",
    "access": 70,
    "accessText": "Texte",
    "safety": 65,
    "safetyText": "Texte",
    "energy": 50,
    "energyText": "Texte"
  },
  "signals": {
    "positive": ["Point", "Point"],
    "negative": ["Point", "Point"]
  },
  "questions": ["Question", "Question"],
  "sources": []
}
`;

    // -----------------------------
    // OPENAI
    // -----------------------------

    const response = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          input: prompt
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({
        error: data.error?.message || "Erreur OpenAI"
      });
    }

    const text =
      data.output_text ||
      data.output?.[0]?.content?.[0]?.text ||
      "";

    let parsed;

    try {
      parsed = JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : null;
    }

    if (!parsed) {
      return res.status(500).json({
        error: "JSON invalide"
      });
    }

    return res.status(200).json(parsed);

  } catch (error) {
    return res.status(500).json({
      error: error.message || "Erreur serveur"
    });
  }
}
