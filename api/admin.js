const { STATUSES, EMAIL_RE, db, createRepair, sendMail, same, token, isAdmin } = require("./_lib");
const { sendReport, sendMonthReport, periodData } = require("./_rapport");

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

/* envoi garanti : une 2e tentative si la première échoue */
async function sendTry(m) {
  let r = await sendMail(m);
  if (!r.ok) { await sleep(700); r = await sendMail(m); }
  return r;
}
const fr = (n) => (n == null ? "—" : new Intl.NumberFormat("fr-FR").format(n) + " F");
/* e-mail d'alerte au propriétaire (NOTIFY_TO) à chaque suppression ou modification d'une réparation */
async function alertOwner(title, changes, r) {
  const to = (process.env.NOTIFY_TO || "").split(",").map((x) => x.trim()).filter(Boolean);
  if (!to.length) return "none";
  const when = new Date().toLocaleString("fr-FR", { timeZone: "Africa/Abidjan" });
  const info = [
    ["Code", r.code],
    ["Client", `${r.name || "—"} · ${r.phone}`],
    ["Appareil", [r.brand, r.model].filter(Boolean).join(" ") || "—"],
    ["Réparation", r.piece || "—"],
    ["Prix client", fr(r.price)],
    ["Achat", fr(r.cost)],
    ["État", STATUSES[r.status] || r.status],
  ];
  const td = "padding:6px;border:1px solid #d4e0f2;font-size:13px";
  const html = `<div style="font-family:Arial,sans-serif;color:#0a1b3d;max-width:560px">
    <h2 style="color:#b00020;margin:0 0 4px">${esc(title)}</h2><p style="margin:0 0 12px;color:#4a6288">${esc(when)}</p>
    ${changes.length ? `<ul>${changes.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}
    <table style="border-collapse:collapse;width:100%">${info.map(([k, v]) => `<tr><td style="${td};background:#eef3fb;font-weight:bold;width:34%">${esc(k)}</td><td style="${td}">${esc(v)}</td></tr>`).join("")}</table></div>`;
  const text = `${title}\n${when}\n\n${changes.join("\n")}\n\n` + info.map(([k, v]) => `${k} : ${v}`).join("\n");
  return (await sendTry({ to, subject: `${title} – ${r.code}`, html, text })).ok ? "sent" : "failed";
}
/* alerte propriétaire pour la caisse (sortie supprimée) */
async function alertCash(title, o) {
  const to = (process.env.NOTIFY_TO || "").split(",").map((x) => x.trim()).filter(Boolean);
  if (!to.length) return "none";
  const when = new Date().toLocaleString("fr-FR", { timeZone: "Africa/Abidjan" });
  const made = new Date(o.created_at).toLocaleString("fr-FR", { timeZone: "Africa/Abidjan" });
  const html = `<div style="font-family:Arial,sans-serif;color:#0a1b3d;max-width:560px">
    <h2 style="color:#b00020;margin:0 0 4px">${esc(title)}</h2><p style="margin:0 0 12px;color:#4a6288">${esc(when)}</p>
    <p><b>Motif :</b> ${esc(o.reason)}<br><b>Montant :</b> ${esc(fr(o.amount))}<br><b>Enregistrée le :</b> ${esc(made)}</p></div>`;
  const text = `${title}\n${when}\n\nMotif : ${o.reason}\nMontant : ${fr(o.amount)}\nEnregistrée le : ${made}`;
  return (await sendTry({ to, subject: `${title} – ${fr(o.amount)}`, html, text })).ok ? "sent" : "failed";
}

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
      const rows = await q`select * from repairs order by created_at desc limit 2000`;
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
      const cost =
        b.cost === undefined ? cur.cost
        : b.cost === "" || b.cost === null ? null
        : Math.max(0, Math.round(Number(b.cost)) || 0);
      const note = b.note === undefined ? cur.note : String(b.note).slice(0, 1000);
      const rows = await q`update repairs set status = ${status}, price = ${price}, cost = ${cost}, note = ${note}, updated_at = now()
        where id = ${id} returning *`;
      const row = rows[0];
      let mail = "none";
      if (row.email && row.status !== cur.status) {
        const host = req.headers["x-forwarded-host"] || req.headers.host;
        mail = (await sendMail(statusMail(row, host))).ok ? "sent" : "failed";
      }
      const changes = [];
      if (row.status !== cur.status) changes.push(`État : ${STATUSES[cur.status] || cur.status} → ${STATUSES[row.status] || row.status}`);
      if (row.price !== cur.price) changes.push(`Prix client : ${fr(cur.price)} → ${fr(row.price)}`);
      if (row.cost !== cur.cost) changes.push(`Achat : ${fr(cur.cost)} → ${fr(row.cost)}`);
      if ((row.note || "") !== (cur.note || "")) changes.push(`Note interne : « ${cur.note || ""} » → « ${row.note || ""} »`);
      const alert = changes.length ? await alertOwner("Réparation modifiée", changes, row) : "none";
      return res.status(200).json({ ok: true, row, mail, alert });
    }
    if (b.action === "create") {
      const email = one(b.email, 120);
      const n0 = (v) => Math.max(0, Math.round(Number(v)) || 0);
      const items = (Array.isArray(b.items) ? b.items : []).slice(0, 10)
        .map((i) => ({ piece: one(i.piece, 60), sale: n0(i.sale), cost: n0(i.cost) })).filter((i) => i.piece);
      const sale = items.reduce((s, i) => s + i.sale, 0), cost = items.reduce((s, i) => s + i.cost, 0);
      const d = { kind: "atelier", source: "atelier", name: one(b.name, 80), phone: one(b.phone, 30), email: EMAIL_RE.test(email) ? email : "", brand: one(b.brand, 40),
        model: one(b.model, 80), piece: items.map((i) => i.piece).join(" + ").slice(0, 200), issue: one(b.issue, 800),
        price: items.length ? sale : null, cost: items.length ? cost : null, items: items.length ? JSON.stringify(items) : null };
      if (!d.phone || !d.model) return res.status(400).json({ ok: false, error: "invalid" });
      const code = await createRepair(d);
      return res.status(200).json({ ok: true, code });
    }
    if (b.action === "delete") {
      const id = Number(b.id);
      const cur = (await q`select * from repairs where id = ${id}`)[0];
      if (!cur) return res.status(404).json({ ok: false, error: "notfound" });
      await q`delete from repairs where id = ${id}`;
      const alert = await alertOwner("Réparation SUPPRIMÉE", ["Cette réparation a été supprimée de l'espace atelier."], cur);
      return res.status(200).json({ ok: true, alert });
    }
    if (b.action === "report_now") {
      const r = await sendReport();
      return res.status(r.ok ? 200 : 502).json({ ok: r.ok, count: r.count, error: r.ok ? undefined : "mail_" + r.status });
    }
    if (b.action === "cash_summary") {
      const pub = (d) => ({ sales: d.sales, cost: d.cost, out: d.out, margin: d.margin, solde: d.solde, count: d.count, outs: d.outs });
      const day = await periodData("day");
      const month = await periodData("month");
      return res.status(200).json({ ok: true, day: pub(day), month: pub(month) });
    }
    if (b.action === "cash_add") {
      const amount = Math.round(Number(b.amount));
      const reason = one(b.reason, 120);
      if (!Number.isFinite(amount) || amount <= 0 || !reason) return res.status(400).json({ ok: false, error: "invalid" });
      const row = (await q`insert into cash_out (amount, reason) values (${amount}, ${reason}) returning *`)[0];
      return res.status(200).json({ ok: true, row });
    }
    if (b.action === "cash_delete") {
      const id = Number(b.id);
      const cur = (await q`select * from cash_out where id = ${id}`)[0];
      if (!cur) return res.status(404).json({ ok: false, error: "notfound" });
      await q`delete from cash_out where id = ${id}`;
      const alert = await alertCash("Sortie de caisse SUPPRIMÉE", cur);
      return res.status(200).json({ ok: true, alert });
    }
    if (b.action === "report_month") {
      const r = await sendMonthReport();
      return res.status(r.ok ? 200 : 502).json({ ok: r.ok, count: r.count, error: r.ok ? undefined : "mail_" + r.status });
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
