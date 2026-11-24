const { db } = require("./_lib");

/* liste publique des bannières actives (page d'accueil). Si la liste est vide ou en erreur, le site garde ses 3 bannières d'origine. */
module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false });
  }
  if (!process.env.DATABASE_URL) return res.status(503).json({ ok: false, error: "config" });
  try {
    const q = await db();
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Abidjan" });
    const rows = await q`select id, alt, link, extract(epoch from updated_at)::bigint as v from banners
      where active and (starts is null or starts <= ${today}::date) and (ends is null or ends >= ${today}::date)
      order by pos, id`;
    res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");
    return res.status(200).json({ ok: true, rows });
  } catch (e) {
    console.error("bannieres error", e && e.message);
    return res.status(500).json({ ok: false, error: "db" });
  }
};
