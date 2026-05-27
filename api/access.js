export default async function handler(req, res) {
  try {
    const address = String(req.query.address || "").trim();

    if (!address) {
      return res.status(400).json({
        error: "Adresse manquante"
      });
    }

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({
        error: "Variables Supabase manquantes"
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

    // Recherche arrêts proches
    const rpcRes = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/rpc/search_tbm_stops`,
      {
        method: "POST",
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          lon,
          lat,
          radius_m: 800
        })
      }
    );

    const raw = await rpcRes.text();

    if (!rpcRes.ok) {
      return res.status(500).json({
        error: "Erreur recherche arrêts",
        details: raw
      });
    }

    const nearbyStops = JSON.parse(raw);

    const stopIds = nearbyStops.map(s => s.stop_id);

    // Récupération lignes + types
    const accessRes = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/tbm_access?stop_id=in.(${stopIds.join(",")})`,
      {
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
        }
      }
    );

    const accessRaw = await accessRes.text();

    if (!accessRes.ok) {
      return res.status(500).json({
        error: "Erreur tbm_access",
        details: accessRaw
      });
    }

    const accessData = JSON.parse(accessRaw);

    const grouped = {};

    for (const stop of nearbyStops) {
      grouped[stop.stop_id] = {
        stop_name: stop.stop_name,
        distance: Math.round(stop.distance_m),
        transports: []
      };
    }

    for (const row of accessData) {
      if (!grouped[row.stop_id]) continue;

      const label =
        row.route_short_name
          ? `${row.transport_type} ${row.route_short_name}`
          : row.transport_type;

      if (!grouped[row.stop_id].transports.includes(label)) {
        grouped[row.stop_id].transports.push(label);
      }
    }

    const stops = Object.values(grouped)
      .map(stop => ({
        name: stop.stop_name,
        distance: stop.distance,
        lines: stop.transports.slice(0, 4)
      }))
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
