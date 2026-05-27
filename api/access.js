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

  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export default async function handler(req, res) {
  try {
    const address = String(req.query.address || "").trim();
    const radius = Number(req.query.radius || 700);

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
  node(around:${radius},${lat},${lon})["railway"="tram_stop"];
  node(around:${radius},${lat},${lon})["highway"="bus_stop"];
  node(around:${radius},${lat},${lon})["public_transport"="platform"];
);
out body;
`;

    const overpassRes = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ data: overpassQuery })
    });

    const overpassData = await overpassRes.json();

    const seen = new Set();

    const stops = (overpassData.elements || [])
      .map(el => {
        const tags = el.tags || {};
        const name = tags.name || tags.ref || "";

        if (!name || !el.lat || !el.lon) return null;

        let mode = "Transport";

        if (tags.railway === "tram_stop") mode = "Tram";
        else if (tags.highway === "bus_stop") mode = "Bus";
        else if (tags.tram === "yes") mode = "Tram";
        else if (tags.bus === "yes") mode = "Bus";

        const key = `${mode}-${name}`.toLowerCase();
        if (seen.has(key)) return null;
        seen.add(key);

        return {
          name,
          mode,
          distance: distanceMeters(lat, lon, el.lat, el.lon)
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (a.distance !== b.distance) return a.distance - b.distance;
        if (a.mode === "Tram" && b.mode !== "Tram") return -1;
        if (a.mode !== "Tram" && b.mode === "Tram") return 1;
        return 0;
      })
      .slice(0, 5);

    return res.status(200).json({
      address,
      geocoded: {
        label: feature.properties.label,
        city: feature.properties.city,
        lon,
        lat
      },
      radius,
      count: stops.length,
      stops
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Erreur serveur"
    });
  }
}
