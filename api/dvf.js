export default async function handler(req, res) {
  try {
    const address = String(req.query.address || "").trim();
    const radius = Number(req.query.radius || 220);

    if (!address) {
      return res.status(400).json({ error: "Adresse manquante" });
    }

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({ error: "Variables Supabase manquantes" });
    }

    const geoUrl =
      "https://api-adresse.data.gouv.fr/search/?" +
      new URLSearchParams({
        q: address,
        limit: "1"
      });

    const geoRes = await fetch(geoUrl);
    const geoData = await geoRes.json();
    const feature = geoData.features?.[0];

    if (!feature) {
      return res.status(404).json({ error: "Adresse introuvable" });
    }

    const [lon, lat] = feature.geometry.coordinates;

    const rpcUrl = `${process.env.SUPABASE_URL}/rest/v1/rpc/search_dvf_gironde`;

    const rpcRes = await fetch(rpcUrl, {
      method: "POST",
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        lon,
        lat,
        radius_m: radius,
        property_type: "Appartement"
      })
    });

    const text = await rpcRes.text();

    if (!rpcRes.ok) {
      return res.status(500).json({
        error: "Erreur Supabase DVF",
        status: rpcRes.status,
        details: text
      });
    }

    const transactions = JSON.parse(text);

    const prices = transactions
      .map(t => Number(t.prix_m2))
      .filter(n => Number.isFinite(n) && n > 0)
      .sort((a, b) => a - b);

    const average = prices.length
      ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
      : null;

    const median = prices.length
      ? Math.round(prices[Math.floor(prices.length / 2)])
      : null;

    return res.status(200).json({
      address,
      geocoded: {
        label: feature.properties.label,
        city: feature.properties.city,
        cityCode: feature.properties.citycode,
        lon,
        lat
      },
      source: "DVF Gironde / Supabase",
      radius,
      transactionsCount: transactions.length,
      averagePriceM2: average,
      medianPriceM2: median,
      minPriceM2: prices.length ? Math.round(prices[0]) : null,
      maxPriceM2: prices.length ? Math.round(prices[prices.length - 1]) : null,
      transactions
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Erreur serveur"
    });
  }
}
