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
Tu dois analyser l'entrée utilisateur : "${query}"
Mode demandé : "${mode || "auto"}"

Tu dois chercher des informations publiques pertinentes quand c'est possible.
Priorités de recherche :
1. DVF / Demandes de valeurs foncières / data.gouv pour les prix de vente.
2. Informations DPE / énergie quand disponibles.
3. Transports, accessibilité, services, contexte urbain.
4. Sécurité, nuisances, risques, bruit, pollution quand disponibles.
5. Si l'entrée est une annonce, lis l'annonce si elle est publiquement accessible, sinon dis que l'analyse est indicative.

IMPORTANT :
- Ne prétends jamais avoir vérifié une source si tu ne l'as pas trouvée.
- Si l'adresse est vague, dis que c'est une analyse indicative.
- Pas de carte, pas de comparables détaillés.
- Ne donne pas une fausse précision : arrondis et nuance.
- Style : français, sobre, éditorial, direct.
- Réponds UNIQUEMENT en JSON valide.

Structure JSON exacte :
{
  "inputType": "Adresse" ou "Annonce" ou "Recherche vague",
  "confidence": "Analyse sourcée" ou "Lecture annonce" ou "Analyse indicative" ou "Adresse partielle",
  "score": nombre entre 0 et 100,
  "verdict": "texte très court",
  "subtitle": "1 phrase",
  "summary": "1 phrase",
  "fastRead": "1 phrase courte",
  "checkRead": "liste courte en phrase",
  "categories": {
    "life": nombre,
    "lifeText": "phrase",
    "price": nombre,
    "priceText": "phrase mentionnant DVF si utilisé",
    "safety": nombre,
    "safetyText": "phrase",
    "access": nombre,
    "accessText": "phrase",
    "energy": nombre,
    "energyText": "phrase"
  },
  "signals": {
    "positive": ["4 signaux maximum"],
    "negative": ["4 points maximum"]
  },
  "placecheckTake": "2 phrases maximum",
  "questions": ["4 questions avant décision"],
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
        model: "gpt-5.5",
        tools: [{ type: "web_search" }],
        input: prompt,
        temperature: 0.2
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

    return res.status(200).json(parsed);
  } catch (error) {
    return res.status(500).json({ error: error.message || "Erreur serveur" });
  }
}
