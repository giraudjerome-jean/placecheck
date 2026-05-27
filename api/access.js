export default async function handler(req, res) {
  try {
    const address = String(req.query.address || "").trim();

    if (!address) {
      return res.status(400).json({ error: "Adresse manquante" });
    }

    const geoRes = await fetch(
      "https://api-adresse.data.gouv.fr/search/?" +
        new URLSearchParams({ q: address, limit: "1" })
    );

    const geoData = await geoRes.json();
    const feature = geoData.features?.[0];

    if (!feature) {
      return res.status(404).json({ error: "Adresse introuvable" });
    }

    const [lon, lat] = feature.geometry.coordinates;

    const overpassQuery = `
[out:json][timeout:25];
(
  node(around:800,${lat},${lon})["highway"="bus_stop"];
  node(around:800,${lat},${lon})["railway"="tram_stop"];
);
out body;
`;

    const overpassRes = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({ data: overpassQuery })
    });

    const raw = await overpassRes.text();

    if (!overpassRes.ok || raw.trim().startsWith("<")) {
      return res.status(200).json({
        address,
        geocoded: {
          label: feature.properties.label,
          city: feature.properties.city,
          lon,
          lat
        },
        stops: [],
        warning: "Overpass indisponible ou réponse non JSON"
      });
    }

    const data = JSON.parse(raw);

    function distanceMeters(lat1, lon1, lat2, lon2) {
      const R = 6371000;
      const toRad = v => (v * Math.PI) / 180;
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) *
          Math.cos(toRad(lat2)) *
          Math.sin(dLon / 2) ** 2;

      return Math.round(
        R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
      );
    }

    const seen = new Set();

    const stops = (data.elements || [])
      .map(el => {
        const tags = el.tags || {};
        const name = tags.name || tags.ref || "";

        if (!name || !el.lat || !el.lon) return null;

        const type =
          tags.railway === "tram_stop"
            ? "Tram"
            : "Bus";

        const key = `${type}-${name}`.toLowerCase();

        if (seen.has(key)) return null;
        seen.add(key);

        return {
          name,
          type,
          distance: distanceMeters(lat, lon, el.lat, el.lon)
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 6);

    return res.status(200).json({
      address,
      geocoded: {
        label: feature.properties.label,
        city: feature.properties.city,
        lon,
        lat
      },
      stops
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Erreur serveur"
    });
  }
}
