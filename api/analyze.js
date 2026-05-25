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

Sources à chercher quand c'est possible :
1. DVF / data.gouv / Etalab pour les prix de vente réels.
2. Prix de location au m² : SeLoger, MeilleursAgents, Observatoires locaux, agences ou données ouvertes si disponibles.
3. DPE si l’entrée est une annonce ou si des données énergie fiables sont accessibles.
4. Qualité de vie : commerces, rues proches, marchés, jardins, équipements, écoles, services, ambiance de quartier.
5. Accessibilité : tram, métro, bus, gares, stations précises et temps/piéton si disponible.
6. Sécurité / nuisances / risques : Ville Idéale, Bien dans ma ville, Interstats / ministère de l’Intérieur, GeoRisques, données officielles ou avis habitants.
7. Si c'est une annonce, lire l'annonce seulement si elle est publiquement accessible.
8. Pour une annonce, le DPE est prioritaire : cherche explicitement la lettre DPE (A, B, C, D, E, F ou G).

Règles impératives :
- Utilise les données DVF fournies si elles existent.
- Ne mets jamais d'URL dans les champs texte.
- Tous les scores doivent être sur 100.
- Si l’utilisateur donne seulement une adresse, tu n’as pas le droit de juger le prix du bien.
- Pour une adresse seule, affiche des données de marché réelles si disponibles.
- Pas de phrases vagues du type "quartier attractif".
- Sois concret.
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
