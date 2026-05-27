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

    const origin = req.headers.origin || `https://${req.headers.host}`;

    let dvfBlock = "";
    let accessBlock = "";

    try {
      const dvfRes = await fetch(
        `${origin}/api/dvf?address=${encodeURIComponent(query)}&radius=220`
      );

      if (dvfRes.ok) {
        const dvf = await dvfRes.json();

        if (dvf.transactionsCount > 0) {
          dvfBlock = `
Prix observés autour de l'adresse :
- ${dvf.transactionsCount} ventes comparables
- prix moyen observé : ${dvf.averagePriceM2} €/m²
- prix médian observé : ${dvf.medianPriceM2} €/m²
- majorité des ventes comparables : ${dvf.lowRangePriceM2} à ${dvf.highRangePriceM2} €/m²
- rayon analysé : ${dvf.radius} m
`;
        }
      }
    } catch (e) {
      console.log("DVF fetch failed", e);
    }

    try {
      const accessRes = await fetch(
        `${origin}/api/access?address=${encodeURIComponent(query)}`
      );

      if (accessRes.ok) {
        const access = await accessRes.json();

        if (access.stops?.length) {
          accessBlock =
            "Accessibilité réelle autour de l'adresse :\n" +
            access.stops
              .map(s => `- ${s.type} — ${s.name} : ${s.distance} m`)
              .join("\n");
        }
      }
    } catch (e) {
      console.log("ACCESS fetch failed", e);
    }

    const prompt = `
Tu es PlaceCheck, un outil français de lecture immobilière.

Analyse :
"${query}"

Mode :
"${mode || "auto"}"

Données structurées disponibles :

${dvfBlock || "Prix observés : données non disponibles."}

${accessBlock || "Accessibilité : données non disponibles."}

Règles impératives :
- Pour le prix, utilise uniquement le bloc "Prix observés".
- Ne jamais utiliser MeilleursAgents, SeLoger, Bien'ici, Efficity ou autres estimateurs privés.
- Ne cite pas la source dans le texte final.
- Dans priceText, écris une phrase claire et ludique : prix moyen observé, prix médian, majorité des ventes comparables, nombre de ventes et rayon.
- Ne parle pas de fourchette min/max brute.
- Pour l’accessibilité, utilise uniquement les stations fournies dans le bloc accessibilité.
- Toujours citer les arrêts les plus proches d’abord.
- Pour la qualité de vie, cite des éléments concrets du quartier : commerces, cafés, marchés, parc, écoles, rues commerçantes.
- Pas de formule vague du type "quartier attractif".
- Pour une adresse seule, ne pas inventer de DPE.
- Pour une adresse seule, écrire : "DPE non disponible sans annonce ou diagnostic."
- Pour sécurité / nuisances, si aucune donnée structurée n’est fournie, écrire : "Aucun signal particulier identifié."
- Ne mets jamais d'URL dans les champs texte.
- Tous les scores doivent être sur 100.
- Réponds uniquement en JSON valide.

Structure JSON exacte :
{
  "inputType": "Adresse",
  "confidence": "Analyse sourcée",
  "score": 75,
  "verdict": "3 mots maximum",
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

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
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
      return res.status(500).json({ error: "JSON invalide" });
    }

    return res.status(200).json(parsed);
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Erreur serveur"
    });
  }
}
