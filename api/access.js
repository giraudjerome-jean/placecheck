export default async function handler(req, res) {
  try {
    const address = String(req.query.address || "").trim();

    if (!address) {
      return res.status(400).json({
        error: "Adresse manquante"
      });
    }

    const geoRes = await fetch(
      "https://api-adresse.data.gouv.fr/search/?" +
      new URLSearchParams({
        q: address,
        limit: "1"
      })
    );

    const geoData = await geoRes.json();
    const feature = geoData.features?.[0];

    if (!feature) {
      return res.status(404).json({
        error: "Adresse introuvable"
      });
    }

    const [lon, lat] = feature.geometry.coordinates;

    const overpassQuery = `
[out:json];
(
  node(around:600,${lat},${lon})["public_transport"];
  node(around:600,${lat},${lon})["highway"="bus_stop"];
  node(around:600,${lat},${lon})["railway"="tram_stop"];
  node(around:600,${lat},${lon})["station"="subway"];
);
out body;
`;

    const overpassRes = await fetch(
      "https://overpass-api.de/api/interpreter",
      {
        method: "POST",
        body: overpassQuery
      }
    );

    const data = await overpassRes.json();

    const stops = (data.elements || [])
      .map(el => {
        const d =
          Math.sqrt(
            Math.pow((el.lat - lat) * 111000, 2) +
            Math.pow((el.lon - lon) * 85000, 2)
          );

        return {
          name:
            el.tags?.name ||
            "Arrêt sans nom",

          type:
            el.tags?.railway === "tram_stop"
              ? "Tram"
              : el.tags?.station === "subway"
              ? "Métro"
              : "Bus",

          distance: Math.round(d)
        };
      })
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 8);

    return res.status(200).json({
      address,
      stops
    });

  } catch (error) {
    return res.status(500).json({
      error: error.message || "Erreur serveur"
    });
  }
}
