export default async function handler(req, res) {
  try {
    const address = String(req.query.address || "").trim();

    if (!address) {
      return res.status(400).json({
        error: "Adresse manquante"
      });
    }

    // Géocodage adresse
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

    // Overpass OpenStreetMap
    const query = `
[out:json];
(
  node(around:800,${lat},${lon})["highway"="bus_stop"];
  node(around:800,${lat},${lon})["railway"="tram_stop"];
  node(around:800,${lat},${lon})["station"="subway"];
);
out body;
`;

    const overpassRes = await fetch(
      "https://overpass-api.de/api/interpreter",
      {
        method: "POST",
        body: query
      }
    );

    const data = await overpassRes.json();

    function distanceMeters(lat1, lon1, lat2, lon2) {
      const R = 6371000;

      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;

      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) *
        Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

      return Math.round(R * c);
    }

    const stops = (data.elements || [])
      .map(el => {
        const dist = distanceMeters(
          lat,
          lon,
          el.lat,
          el.lon
        );

        return {
          name: el.tags?.name || "Arrêt sans nom",

          type:
            el.tags?.railway === "tram_stop"
              ? "Tram"
              : el.tags?.station === "subway"
              ? "Métro"
              : "Bus",

          distance: dist
        };
      })
      .filter(s => s.distance <= 800)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 6);

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
