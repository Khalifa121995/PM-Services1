const { sendReport } = require("./_rapport");

/* appelé chaque jour à 18h59 par Vercel Cron (voir vercel.json) */
module.exports = async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ ok: false });
  try {
    const r = await sendReport();
    return res.status(r.ok ? 200 : 502).json(r);
  } catch (e) {
    console.error("rapport error", e && e.message);
    return res.status(500).json({ ok: false });
  }
};
