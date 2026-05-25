function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = v => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function cleanName(tags = {}) {
  return tags.name || tags["brand"] || tags["operator"] || "";
}

export default async function handler(req, res) {
  try {
    const address = String(req.query.address || "").trim();
    const radius = Number(req.query.radius || 500);

    if (!address) {
      return res.status(400).json({ error: "Adresse manquante" });
    }

    const geoUrl =
      "https://api-adresse.data.gouv.fr/search/?" +
      new URLSearchParams({ q: address, limit: "1" });

    const geoRes = await fetch(geoUrl);
    const geoData = await geoRes.json();
    const feature = geoData.features?.[0];

    if (!feature) {
      return res.status(404).json({ error: "Adresse introuvable" });
    }

    const [lon, lat] = feature.geometry.coordinates;

    const query = `
[out:json][timeout:25];
(
  node(around:${radius},${lat},${lon})["shop"];
  node(around:${radius},${lat},${lon})["amenity"~"cafe|restaurant|bar|bakery|pharmacy|school|kindergarten|library|theatre|cinema|marketplace"];
  node(around:${radius},${lat},${lon})["leisure"~"park|garden"];
  node(around:${radius},${lat},${lon})["tourism"~"museum|gallery"];
);
out body;
`;

    const overpassRes = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type":
