const { db } = require("./_lib");

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
    return res.status(200).json({ ok: true, rows });
  } catch (e) {
    console.error("prix error", e && e.message);
    return res.status(500).json({ ok: false, error: "db" });
  }
};
