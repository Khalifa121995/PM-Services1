const { STATUSES, db, createRepair, same, token, isAdmin } = require("./_lib");

const one = (s, n = 200) => String(s ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, n);
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
  if (!process.env.ADMIN_PASSWORD || !process.env.DATABASE_URL) {
    return res.status(500).json({ ok: false, error: "config" });
  }

  if (b.action === "login") {
    if (typeof b.password === "string" && same(b.password, process.env.ADMIN_PASSWORD)) {
      res.setHeader("Set-Cookie", `pm_admin=${token()}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200`);
      return res.status(200).json({ ok: true });
    }
    await sleep(900);
    return res.status(401).json({ ok: false, error: "password" });
  }
  if (b.action === "logout") {
    res.setHeader("Set-Cookie", "pm_admin=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0");
    return res.status(200).json({ ok: true });
  }
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: "auth" });

  try {
    const q = await db();
    if (b.action === "list") {
      const rows = await q`select * from repairs order by created_at desc limit 500`;
      return res.status(200).json({ ok: true, rows });
    }
    if (b.action === "update") {
      const id = Number(b.id);
      const cur = (await q`select * from repairs where id = ${id}`)[0];
      if (!cur) return res.status(404).json({ ok: false, error: "notfound" });
      const status = b.status !== undefined && STATUSES[b.status] ? b.status : cur.status;
      const price =
        b.price === undefined ? cur.price
        : b.price === "" || b.price === null ? null
        : Math.max(0, Math.round(Number(b.price)) || 0);
      const note = b.note === undefined ? cur.note : String(b.note).slice(0, 1000);
      const rows = await q`update repairs set status = ${status}, price = ${price}, note = ${note}, updated_at = now()
        where id = ${id} returning *`;
      return res.status(200).json({ ok: true, row: rows[0] });
    }
    if (b.action === "create") {
      const d = { kind: "atelier", name: one(b.name, 80), phone: one(b.phone, 30), brand: one(b.brand, 40),
        model: one(b.model, 80), piece: one(b.piece, 40), issue: one(b.issue, 800) };
      if (!d.phone || !d.model) return res.status(400).json({ ok: false, error: "invalid" });
      const code = await createRepair(d);
      return res.status(200).json({ ok: true, code });
    }
    return res.status(400).json({ ok: false, error: "action" });
  } catch (e) {
    console.error("admin error", e && e.message);
    return res.status(500).json({ ok: false, error: "db" });
  }
};
