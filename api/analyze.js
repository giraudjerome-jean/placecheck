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

    // =========================================
    // DVF
    // =========================================

    let dvfText = "";

    try {
      const dvfResponse = await fetch(
        `${req.headers.origin}/api/dvf?address=${encodeURIComponent(query)}`
      );

      const dvfData = await dvfResponse.json();

      if (dvfData?.transactions?.length) {
        const prices = dvfData.transactions
          .map(t => Number(t.prix_m2))
          .filter(Boolean);

        if (prices.length) {
          const avg = Math.round(
            prices.reduce((a, b) => a + b, 0) / prices.length
          );

          const min = Math.min(...prices);
          const max = Math.max(...prices);

          dvfText = `
DVF réel :
- ${prices.length} transactions trouvées
- Prix moyen : ${avg} €/m²
- Fourchette : ${min} à ${max} €/m²
`;
        }
      }
    } catch (e) {
      console.log("DVF error", e);
    }

    // =========================================
    // PROMPT
    // =========================================

    const prompt = `
Tu es PlaceCheck, un outil français de lecture immobilière.

Analyse : "${query}"
Mode : "${mode || "auto"}"

${dvfText}

Données autorisées :
1. Pour le prix, utiliser uniquement le bloc DVF réel fourni ci-dessus.
2. Ne jamais utiliser MeilleursAgents, SeLoger, Efficity, Bien’ici ou autres estimateurs privés.
3. Si le bloc DVF est vide, écrire exactement : "Données DVF non disponibles pour cette adresse."
4. Pour une adresse seule, ne pas inventer de DPE.
5. Pour une adresse seule, écrire : "DPE non disponible sans annonce ou diagnostic."
6. Pour la qualité de vie et l’accessibilité, rester factuel et prudent si aucune donnée structurée n’est fournie.

Règles impératives :
- Dans priceText, n’écris pas la source. Présente le prix de façon lisible : "Prix moyen observé : X €/m². Fourchette locale : X–X €/m². X ventes comparables dans un rayon de X m."
- Ne mets jamais d’URL dans les champs texte.
- Tous les scores doivent être sur 100.
- Si l’utilisateur donne seulement une adresse, ne juge pas le prix du bien.
- Pas de phrases vagues du type "quartier attractif".
- Réponds uniquement en JSON valide.

Structure JSON exacte :
{
  "inputType": "Adresse",
  "confidence": "Analyse sourcée",
  "score": nombre,
  "verdict": "3 mots max",
  "subtitle": "phrase courte",
  "summary": "phrase courte",
  "categories": {
    "life": nombre,
    "lifeText": "texte",
    "price": nombre,
    "priceText": "texte",
    "safety": nombre,
    "safetyText": "texte",
    "access": nombre,
    "accessText": "texte",
    "energy": nombre,
    "energyText": "texte"
  },
  "signals": {
    "positive": [],
    "negative": []
  },
  "questions": [],
  "sources": []
}
`;

    // =========================================
    // OPENAI
    // =========================================

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
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
        ?.find(content =>
          content.type === "output_text" ||
          content.type === "text"
        )?.text ||
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
        error: "Analyse invalide"
      });
    }

    return res.status(200).json(parsed);

  } catch (error) {
    return res.status(500).json({
      error: error.message || "Erreur serveur"
    });
  }
}
