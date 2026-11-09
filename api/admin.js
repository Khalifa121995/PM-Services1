const { STATUSES, EMAIL_RE, db, createRepair, sendMail, same, token, isAdmin } = require("./_lib");

const one = (s, n = 200) => String(s ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, n);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const MSG = {
  recu: "Nous avons bien reçu votre téléphone.",
  diagnostic: "Notre technicien est en train de diagnostiquer la panne.",
  piece: "Nous attendons une pièce. Nous vous tenons informé.",
  cours: "Votre téléphone est en cours de réparation.",
  pret: "Votre téléphone est prêt : vous pouvez venir le récupérer de 9h00 à 19h30.",
  livre: "Votre téléphone vous a été remis. Merci de votre confiance !",
  annule: "Votre demande a été annulée. Contactez-nous si vous avez une question.",
};
/* e-mail envoyé au client quand l'état change */
function statusMail(r, host) {
  const label = STATUSES[r.status] || r.status;
  const device = [r.brand, r.model].filter(Boolean).join(" ") || "votre téléphone";
  const link = host ? `https://${host}/#suivi` : "";
  const price = r.price ? `Prix convenu : ${new Intl.NumberFormat("fr-FR").format(r.price)} F` : "";
  const text = `Bonjour ${r.name || ""},\n\nÉtat de votre réparation ${r.code} (${device}) : ${label}.\n${MSG[r.status] || ""}\n${price}\n\n${link ? "Suivre ma réparation : " + link + "\n" : ""}PM Services`;
  const html = `<div style="font-family:Arial,sans-serif;color:#0a1b3d;max-width:520px">
    <h2 style="color:#0a2a6b;margin:0 0 10px">Votre réparation ${esc(r.code)}</h2>
    <p>Bonjour ${esc(r.name || "")},</p>
    <p>${esc(device)} – état actuel : <b style="color:#1d4fbf">${esc(label)}</b></p>
    <p>${esc(MSG[r.status] || "")}</p>${price ? `<p><b>${esc(price)}</b></p>` : ""}
    ${link ? `<p><a href="${esc(link)}" style="background:#0a2a6b;color:#fff;padding:10px 16px;border-radius:20px;text-decoration:none">Suivre ma réparation</a></p>` : ""}
    <p style="color:#4a6288">PM Services</p></div>`;
  return { to: r.email, subject: `PM Services – Réparation ${r.code} : ${label}`, text, html };
}
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
      const row = rows[0];
      let mail = "none";
      if (row.email && row.status !== cur.status) {
        const host = req.headers["x-forwarded-host"] || req.headers.host;
        mail = (await sendMail(statusMail(row, host))).ok ? "sent" : "failed";
      }
      return res.status(200).json({ ok: true, row, mail });
    }
    if (b.action === "create") {
      const email = one(b.email, 120);
      const d = { kind: "atelier", name: one(b.name, 80), phone: one(b.phone, 30), email: EMAIL_RE.test(email) ? email : "", brand: one(b.brand, 40),
        model: one(b.model, 80), piece: one(b.piece, 40), issue: one(b.issue, 800) };
      if (!d.phone || !d.model) return res.status(400).json({ ok: false, error: "invalid" });
      const code = await createRepair(d);
      return res.status(200).json({ ok: true, code });
    }
    if (b.action === "price_list") {
      const rows = await q`select * from prices order by piece, brand, id`;
      return res.status(200).json({ ok: true, rows });
    }
    if (b.action === "price_save") {
      const p = { piece: one(b.piece, 40), brand: one(b.brand, 40), label: one(b.label, 120), quality: one(b.quality, 40) || null,
        models: String(b.models || "").trim().slice(0, 600) || null, price: Math.round(Number(b.price)) };
      if (!p.piece || !p.brand || !p.label || !Number.isFinite(p.price) || p.price < 0) {
        return res.status(400).json({ ok: false, error: "invalid" });
      }
      try {
        const id = Number(b.id);
        const rows = id
          ? await q`update prices set piece = ${p.piece}, brand = ${p.brand}, label = ${p.label}, quality = ${p.quality},
              price = ${p.price}, models = ${p.models}, updated_at = now() where id = ${id} returning *`
          : await q`insert into prices (piece, brand, label, quality, price, models)
              values (${p.piece}, ${p.brand}, ${p.label}, ${p.quality}, ${p.price}, ${p.models}) returning *`;
        if (!rows[0]) return res.status(404).json({ ok: false, error: "notfound" });
        return res.status(200).json({ ok: true, row: rows[0] });
      } catch (e) {
        if (e && e.code === "23505") return res.status(409).json({ ok: false, error: "exists" });
        throw e;
      }
    }
    if (b.action === "price_delete") {
      await q`delete from prices where id = ${Number(b.id)}`;
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ ok: false, error: "action" });
  } catch (e) {
    console.error("admin error", e && e.message);
    return res.status(500).json({ ok: false, error: "db" });
  }
};
