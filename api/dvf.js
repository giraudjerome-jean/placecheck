export default async function handler(req, res) {
  try {
    const address = String(req.query.address || "").trim();

    if (!address) {
      return res.status(400).json({
        error: "Adresse manquante"
      });
    }

    // 1. Géocodage adresse → coordonnées
    const geoRes = await fetch(
      `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(address)}&limit=1`
    );

    const geoData = await geoRes.json();

    if (!geoData.features?.length) {
      return res.status(404).json({
        error: "Adresse introuvable"
      });
    }

    const feature = geoData.features[0];

    const lon = feature.geometry.coordinates[0];
    const lat = feature.geometry.coordinates[1];

    // rayon ~300m
    const radius = 0.003;

    const bbox = [
      lon - radius,
      lat - radius,
      lon + radius,
      lat + radius
    ].join(",");

    // 2. Appel DVF Etalab
    const dvfUrl =
      `https://apidf-preprod.cerema.fr/dvf?bbox=${bbox}`;

    const dvfRes = await fetch(dvfUrl);

    if (!dvfRes.ok) {
      const txt = await dvfRes.text();

      return res.status(500).json({
        error: "DVF API error",
        status: dvfRes.status,
        details: txt
      });
    }

    const dvfData = await dvfRes.json();

    const mutations = Array.isArray(dvfData.features)
      ? dvfData.features
      : [];

    const prices = [];

    for (const item of mutations) {
      const props = item.properties || {};

      const valeur = Number(props.valeurfonc);
      const surface = Number(props.sbati);

      if (
        Number.isFinite(valeur) &&
        Number.isFinite(surface) &&
        surface > 8
      ) {
        prices.push(valeur / surface);
      }
    }

    if (!prices.length) {
      return res.status(200).json({
        source: "DVF",
        transactionsCount: 0
      });
    }

    prices.sort((a, b) => a - b);

    const avg =
      prices.reduce((a, b) => a + b, 0) / prices.length;

    return res.status(200).json({
      source: "DVF",
      address: feature.properties.label,
      latitude: lat,
      longitude: lon,
      transactionsCount: prices.length,
      averagePriceM2: Math.round(avg),
      minPriceM2: Math.round(prices[0]),
      maxPriceM2: Math.round(prices[prices.length - 1])
    });

  } catch (error) {
    return res.status(500).json({
      error: error.message || "Erreur serveur",
      stack: error.stack
    });
  }
}
