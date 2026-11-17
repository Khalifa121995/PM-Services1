const { db } = require("./_lib");

// Promotion en cours : pour l'arrêter, mettre active à false (ou changer pct / pièce / arrondi).
const PROMO = { active: true, piece: "Écran", pct: 20, step: 500 };
const withPromo = (r) => {
  if (!PROMO.active || r.piece !== PROMO.piece) return r;
  const price = Math.round((r.price * (100 - PROMO.pct)) / 100 / PROMO.step) * PROMO.step; // ex. 10000 -> 8000
  return price > 0 && price < r.price ? { ...r, price, old: r.price, promo: PROMO.pct } : r;
};

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false });
  }
  if (!process.env.DATABASE_URL) return res.status(503).json({ ok: false, error: "config" });
  try {
    const q = await db();
    const rows = await q`select id, piece, brand, label, quality, price, models from prices order by piece, brand, id`;
    res.setHeader("Cache-Control", "public, s-maxage=20, stale-while-revalidate=60");
    return res.status(200).json({ ok: true, rows: rows.map(withPromo) });
  } catch (e) {
    console.error("prix error", e && e.message);
    return res.status(500).json({ ok: false, error: "db" });
  }
};
