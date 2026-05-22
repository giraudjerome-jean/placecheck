export default async function handler(req, res) {
  try {
    const address = String(req.query.address || "").trim();

    if (!address) {
      return res.status(400).json({ error: "Adresse manquante" });
    }

    const geoUrl =
      "https://api-adresse.data.gouv.fr/search/?" +
      new URLSearchParams({
        q: address,
        limit: "1",
      });

    const geoRes = await fetch(geoUrl);
    const geoData = await geoRes.json();

    const feature = geoData.features?.[0];

    if (!feature) {
      return res.status(404).json({ error: "Adresse introuvable" });
    }

    const [lon, lat] = feature.geometry.coordinates;
    const cityCode = feature.properties.citycode;

    // Rayon d’environ 300 m autour de l’adresse
    const delta = 0.003;

    const bbox = [
      lon - delta,
      lat - delta,
      lon + delta,
      lat + delta,
    ].join(",");

    // API Données foncières / Cerema — DVF+ open-data
    // Cette URL est à valider selon le endpoint exact disponible côté Cerema.
    const dvfUrl =
      "https://apidf-preprod.cerema.fr/dvf/opendata/mutations?" +
      new URLSearchParams({
        code_insee: cityCode,
        bbox,
        limit: "50",
      });

    const dvfRes = await fetch(dvfUrl);
    const dvfText = await dvfRes.text();

    if (!dvfRes.ok) {
      return res.status(502).json({
        error: "DVF API error",
        geocoded: {
          label: feature.properties.label,
          cityCode,
          lat,
          lon,
        },
        dvfUrl,
        status: dvfRes.status,
        response: dvfText.slice(0, 500),
      });
    }

    let dvfData;
    try {
      dvfData = JSON.parse(dvfText);
    } catch {
      return res.status(502).json({
        error: "Réponse DVF non JSON",
        dvfUrl,
        response: dvfText.slice(0, 500),
      });
    }

    const raw = Array.isArray(dvfData)
      ? dvfData
      : dvfData.features || dvfData.results || dvfData.data || [];

    const transactions = raw
      .map((item) => item.properties || item)
      .map((item) => {
        const price =
          Number(item.valeur_fonciere || item.valeurfonc || item.prix || 0);

        const surface =
          Number(item.surface_reelle_bati || item.sbati || item.surface || 0);

        const priceM2 =
          price > 0 && surface > 0 ? Math.round(price / surface) : null;

        return {
          date: item.date_mutation || item.datemut || item.date || null,
          type: item.type_local || item.libtypbien || item.type || null,
          price,
          surface,
          priceM2,
          address: item.adresse || item.l_adresse || null,
        };
      })
      .filter((t) => t.priceM2 && t.priceM2 > 1000 && t.priceM2 < 20000)
      .slice(0, 20);

    const prices = transactions.map((t) => t.priceM2);

    const average =
      prices.length > 0
        ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
        : null;

    return res.status(200).json({
      address,
      geocoded: {
        label: feature.properties.label,
        cityCode,
        lat,
        lon,
      },
      source: "DVF+ / API Données foncières Cerema",
      transactionsCount: transactions.length,
      averagePriceM2: average,
      minPriceM2: prices.length ? Math.min(...prices) : null,
      maxPriceM2: prices.length ? Math.max(...prices) : null,
      transactions,
      debug: {
        dvfUrl,
      },
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Erreur serveur",
    });
  }
}
