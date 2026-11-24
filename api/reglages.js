const { db, getSettings, SET_DEFAULTS } = require("./_lib");

/* réglages publics du site (horaires, WhatsApp, frais de déplacement, annonce…).
   Si la base est indisponible, le site garde les textes écrits dans la page. */
module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false });
  }
  if (!process.env.DATABASE_URL) return res.status(503).json({ ok: false, error: "config" });
  try {
    const q = await db();
    const s = await getSettings(q);
    res.setHeader("Cache-Control", "public, s-maxage=20, stale-while-revalidate=60");
    return res.status(200).json({
      ok: true,
      s: {
        hours_open: s.hours_open, hours_close: s.hours_close, whatsapp: s.whatsapp,
        delivery_fee: s.delivery_fee, screen_offer: s.screen_offer, facebook: s.facebook,
        announce: s.announce.active && s.announce.text ? { text: s.announce.text, link: s.announce.link } : null,
      },
    });
  } catch (e) {
    console.error("reglages error", e && e.message);
    return res.status(500).json({ ok: false, error: "db" });
  }
};
