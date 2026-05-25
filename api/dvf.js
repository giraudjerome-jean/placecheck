import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  try {

    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);

    if (!lat || !lon) {
      return res.status(400).json({
        error: "lat/lon manquants"
      });
    }

    const sql = `
      select
        datemut,
        valeurfonc,
        sbati,
        prix_m2,
        libtypbien
      from dvf_gironde
      where ST_DWithin(
        geom,
        ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 2154),
        300
      )
      order by datemut desc
      limit 30
    `;

    const { data, error } = await supabase.rpc("exec_sql", {
      sql
    });

    if (error) {
      return res.status(500).json({
        error: error.message
      });
    }

    const prix = data
      .map(r => Number(r.prix_m2))
      .filter(Boolean);

    const moyenne =
      prix.reduce((a, b) => a + b, 0) / prix.length;

    return res.status(200).json({
      count: data.length,
      prix_m2_moyen: Math.round(moyenne),
      ventes: data
    });

  } catch (e) {
    return res.status(500).json({
      error: e.message
    });
  }
}
