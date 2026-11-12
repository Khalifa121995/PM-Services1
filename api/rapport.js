const { sendReport, sendMonthReport } = require("./_rapport");

/* appelé chaque jour à 18h59 par Vercel Cron (voir vercel.json).
   Le dernier jour du mois, le rapport du mois part en plus du rapport du jour. */
module.exports = async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ ok: false });
  try {
    const r = await sendReport();
    const demain = new Date(Date.now() + 24 * 3600 * 1000);
    const jour = Number(demain.toLocaleDateString("en-GB", { timeZone: "Africa/Abidjan", day: "numeric" }));
    let mois = null;
    if (jour === 1) mois = await sendMonthReport();
    return res.status(r.ok ? 200 : 502).json({ ...r, mois });
  } catch (e) {
    console.error("rapport error", e && e.message);
    return res.status(500).json({ ok: false });
  }
};
