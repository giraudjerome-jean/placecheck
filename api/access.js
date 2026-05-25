export default async function handler(req, res) {
  try {
    const address = String(req.query.address || "").trim();

    if (!address) {
      return res.status(400).json({
        error: "Adresse manquante"
      });
    }

    // -------------------------
    // GEOCODAGE
    // -------------------------

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
      return res.status(404).json({
        error: "Adresse introuvable"
      });
    }

    const [lon, lat] = feature.geometry.coordinates;

    // -------------------------
    // OVERPASS
    // -------------------------

    const query = `
[out:json];
(
  node(around:600,${lat},${lon})["public_transport"];
  node(around:600,${lat},${lon})["railway"="tram_stop"];
  node(around:600,${lat},${lon})["highway"="bus_stop"];
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

    const overpassData = await overpassRes.json();

    const elements = overpassData.elements || [];

    function distance(aLat, aLon, bLat, bLon) {
      const R = 6371e3;

      const φ1 = aLat * Math.PI / 180;
      const φ2 = bLat * Math.PI / 180;

      const Δφ = (bLat - aLat) * Math.PI / 180;
      const Δλ = (bLon - aLon) * Math.PI / 180;

      const x =
        Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) *
        Math.cos(φ2) *
        Math.sin(Δλ / 2) *
        Math.sin(Δλ / 2);

      const y = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));

      return Math.round(R * y);
    }

    const stops = elements
      .map(el => {
        const name = el.tags?.name;

        if (!name) return null;

        return {
          name,
          type:
            el.tags?.railway === "tram_stop"
              ? "Tram"
              : "Bus",
          distance: distance(
            lat,
            lon,
            el.lat,
            el.lon
          )
        };
      })
      .filter(Boolean)
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
