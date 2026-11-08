const { STATUSES, db } = require("./_lib");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false });
  }
  let b = req.body;
  if (typeof b === "string") {
    try { b = JSON.parse(b); } catch { b = {}; }
  }
  b = b || {};
  const code = String(b.code || "").trim().toUpperCase();
  const phone = String(b.phone || "").replace(/\D/g, "");
  if (!/^PM-\d{6}$/.test(code) || phone.length < 8) return res.status(400).json({ ok: false, error: "invalid" });
  if (!process.env.DATABASE_URL) return res.status(503).json({ ok: false, error: "config" });
  try {
    const q = await db();
    const r = (await q`select phone, status, price, brand, model, piece, updated_at from repairs where code = ${code}`)[0];
    if (!r || String(r.phone).replace(/\D/g, "").slice(-8) !== phone.slice(-8)) {
      await sleep(600);
      return res.status(404).json({ ok: false, error: "notfound" });
    }
    return res.status(200).json({
      ok: true,
      label: STATUSES[r.status] || r.status,
      price: r.price,
      device: [r.brand, r.model].filter(Boolean).join(" ") || "Votre appareil",
      updated: r.updated_at,
    });
  } catch (e) {
    console.error("suivi error", e && e.message);
    return res.status(500).json({ ok: false, error: "db" });
  }
};
