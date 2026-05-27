import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  try {
    const address = String(req.query.address || "").trim();

    if (!address) {
      return res.status(400).json({
        error: "Adresse manquante"
      });
    }

    // Géocodage
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

    // Recherche arrêts TBM
    const { data, error } = await supabase.rpc(
      "search_tbm_stops",
      {
        lon,
        lat,
        radius_m: 800
      }
    );

    if (error) {
      return res.status(500).json({
        error: error.message
      });
    }

    const stops = (data || []).map(stop => ({
      name: stop.stop_name,
      distance: Math.round(stop.distance_m),
      type: "Transport"
    }));

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
