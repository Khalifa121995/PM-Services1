const { STATUSES, EMAIL_RE, PERMS, PERM_KEYS, cleanPerms, parsePerms, hashPw, checkPw, DUMMY_HASH, getSession, db, createRepair, sendMail, same, token } = require("./_lib");
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
async function alertOwner(title, changes, r, who) {
  if (who && who.role === "staff") changes = [...changes, `Effectué par : ${who.name} (compte ${who.username})`];
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

/* ---- ajout automatique des modèles inconnus dans la base des prix ---- */
const STRIP = /^(?:(?:galaxy|samsung|tecno|infinix|itel|xiaomi|huawei|oppo|vivo|realme|honor|apple|google)\s+)+/;
const nk = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim().replace(STRIP, "").replace(/ /g, "");
function modelKeys(r) {
  const seg = String(r.label).split("/").map((x) => x.trim()).filter(Boolean);
  const pre = ((seg[0] || "").match(/^\D*/) || [""])[0];
  const keys = seg.map((x) => nk(/^\d/.test(x) ? pre + x : x));
  String(r.models || "").split(",").forEach((x) => { if (x.trim()) keys.push(nk(x)); });
  return keys;
}
async function autoPrices(q, brand, model, items) {
  const added = [], mk = nk(model);
  if (!brand || !mk) return added;
  const all = await q`select piece, brand, label, models from prices`;
  const known = all.find((r) => r.brand.toLowerCase() === brand.toLowerCase());
  const b = known ? known.brand : brand;
  for (const it of items) {
    if (!(it.sale > 0) || !it.piece || it.piece.toLowerCase() === "autre") continue;
    const covered = all.some((r) => r.piece.toLowerCase() === it.piece.toLowerCase() &&
      (r.brand.toLowerCase() === b.toLowerCase() || r.brand === "Autres Android") && modelKeys(r).includes(mk));
    if (covered) continue;
    const ins = await q`insert into prices (piece, brand, label, quality, price, models)
      values (${it.piece}, ${b}, ${model}, null, ${it.sale}, null) on conflict do nothing returning id`;
    if (ins.length) { added.push(it.piece); all.push({ piece: it.piece, brand: b, label: model, models: null }); }
  }
  return added;
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

  const cookie = (v, age) => `pm_admin=${v}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${age}`;
  const meOf = (u) => ({ role: u.role, name: u.name, username: u.username, perms: u.perms, labels: PERMS });

  if (b.action === "login") {
    const uname = String(b.username || "").trim().toLowerCase();
    const pw = typeof b.password === "string" ? b.password : "";
    /* super admin : identifiant vide ou "admin" + mot de passe défini sur Vercel */
    if (!uname || uname === "admin") {
      if (pw && same(pw, process.env.ADMIN_PASSWORD)) {
        res.setHeader("Set-Cookie", cookie(token("super", 0), 43200));
        return res.status(200).json({ ok: true, me: meOf({ role: "super", name: "Super admin", username: "admin", perms: PERM_KEYS }) });
      }
      await sleep(900);
      return res.status(401).json({ ok: false, error: "password" });
    }
    /* compte staff */
    try {
      const q = await db();
      const u = (await q`select * from staff where username = ${uname}`)[0];
      if (u && u.locked_until && new Date(u.locked_until) > new Date()) {
        await sleep(600);
        return res.status(429).json({ ok: false, error: "locked" });
      }
      const good = checkPw(pw, u ? u.pass_hash : DUMMY_HASH) && !!u;
      if (!good) {
        if (u) {
          const f = (u.fails || 0) + 1;
          if (f >= 5) await q`update staff set fails = 0, locked_until = now() + interval '10 minutes' where id = ${u.id}`;
          else await q`update staff set fails = ${f} where id = ${u.id}`;
        }
        await sleep(900);
        return res.status(401).json({ ok: false, error: "password" });
      }
      if (!u.active) return res.status(403).json({ ok: false, error: "disabled" });
      await q`update staff set fails = 0, locked_until = null, last_login = now() where id = ${u.id}`;
      await q`insert into staff_log (actor_id, actor_name, action, detail) values (${u.id}, ${u.name}, 'Connexion', null)`;
      res.setHeader("Set-Cookie", cookie(token("staff", u.id), 43200));
      return res.status(200).json({ ok: true, me: meOf({ role: "staff", name: u.name, username: u.username, perms: parsePerms(u.perms) }) });
    } catch (e) {
      console.error("login error", e && e.message);
      return res.status(500).json({ ok: false, error: "db" });
    }
  }
  if (b.action === "logout") {
    res.setHeader("Set-Cookie", cookie("", 0));
    return res.status(200).json({ ok: true });
  }

  try {
    const q = await db();
    const me = await getSession(req, q);
    if (!me) return res.status(401).json({ ok: false, error: "auth" });
    const isSuper = me.role === "super";
    const can = (...p) => isSuper || p.some((k) => me.perms.includes(k));
    const deny = () => res.status(403).json({ ok: false, error: "forbidden" });
    const logAct = async (action, detail) => {
      try { await q`insert into staff_log (actor_id, actor_name, action, detail) values (${me.id || null}, ${me.name}, ${action}, ${detail || null})`; }
      catch (e) { console.error("journal", e && e.message); }
    };
    /* qui a le droit de faire quoi */
    const NEED = {
      create: ["create"], delete: ["delete"], report_now: ["reports"], report_month: ["reports"],
      cash_summary: ["cash"], cash_add: ["cash"], cash_delete: ["cash"],
      price_list: ["prices", "create"], price_save: ["prices"], price_delete: ["prices"],
      stock_list: ["stock", "create"], stock_move: ["stock"], stock_delete: ["stock"],
      update: ["update", "edit_price", "cost"],
      banner_list: ["banners"], banner_save: ["banners"], banner_delete: ["banners"], banner_order: ["banners"],
    };
    const SUPER_ONLY = ["staff_list", "staff_save", "staff_password", "staff_delete", "staff_log"];
    if (SUPER_ONLY.includes(b.action) && !isSuper) return deny();
    if (NEED[b.action] && !can(...NEED[b.action])) return deny();
    /* le staff sans la permission « cost » ne voit jamais les prix d'achat */
    const clean = (r) => {
      if (can("cost")) return r;
      let items = r.items;
      try { const a = JSON.parse(r.items || "null"); if (Array.isArray(a)) items = JSON.stringify(a.map((i) => ({ ...i, cost: null }))); } catch {}
      return { ...r, cost: null, items };
    };

    if (b.action === "me") return res.status(200).json({ ok: true, me: meOf(me) });
    if (b.action === "change_password") {
      if (isSuper) return res.status(400).json({ ok: false, error: "super" });
      const np = String(b.new_password || "");
      if (np.length < 6 || np.length > 100) return res.status(400).json({ ok: false, error: "weak" });
      const u = (await q`select pass_hash from staff where id = ${me.id}`)[0];
      if (!u || !checkPw(String(b.old_password || ""), u.pass_hash)) { await sleep(900); return res.status(401).json({ ok: false, error: "password" }); }
      await q`update staff set pass_hash = ${hashPw(np)} where id = ${me.id}`;
      await logAct("Mot de passe changé", null);
      return res.status(200).json({ ok: true });
    }
    if (b.action === "list") {
      let rows = await q`select * from repairs order by created_at desc limit 2000`;
      if (!can("archives")) rows = rows.filter((r) => r.status !== "livre" && r.status !== "annule");
      return res.status(200).json({ ok: true, rows: rows.map(clean) });
    }
    if (b.action === "update") {
      const id = Number(b.id);
      const cur = (await q`select * from repairs where id = ${id}`)[0];
      if (!cur) return res.status(404).json({ ok: false, error: "notfound" });
      if (!can("archives") && (cur.status === "livre" || cur.status === "annule")) return deny();
      const status = can("update") && b.status !== undefined && STATUSES[b.status] ? b.status : cur.status;
      const price =
        !can("edit_price") || b.price === undefined ? cur.price
        : b.price === "" || b.price === null ? null
        : Math.max(0, Math.round(Number(b.price)) || 0);
      const cost =
        !can("cost") || b.cost === undefined ? cur.cost
        : b.cost === "" || b.cost === null ? null
        : Math.max(0, Math.round(Number(b.cost)) || 0);
      const note = !can("update") || b.note === undefined ? cur.note : String(b.note).slice(0, 1000);
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
      const alert = changes.length ? await alertOwner("Réparation modifiée", changes, row, me) : "none";
      if (changes.length) await logAct("Réparation modifiée", `${row.code} : ${changes.join(" ; ")}`.slice(0, 400));
      return res.status(200).json({ ok: true, row: clean(row), mail, alert });
    }
    if (b.action === "create") {
      const email = one(b.email, 120);
      const n0 = (v) => Math.max(0, Math.round(Number(v)) || 0);
      const items = (Array.isArray(b.items) ? b.items : []).slice(0, 10)
        .map((i) => ({ piece: one(i.piece, 60), sale: n0(i.sale), cost: can("cost") ? n0(i.cost) : 0 })).filter((i) => i.piece);
      const sale = items.reduce((s, i) => s + i.sale, 0), cost = items.reduce((s, i) => s + i.cost, 0);
      const d = { kind: "atelier", source: "atelier", name: one(b.name, 80), phone: one(b.phone, 30), email: EMAIL_RE.test(email) ? email : "", brand: one(b.brand, 40),
        model: one(b.model, 80), piece: items.map((i) => i.piece).join(" + ").slice(0, 200), issue: one(b.issue, 800),
        price: items.length ? sale : null, cost: items.length && can("cost") ? cost : null, items: items.length ? JSON.stringify(items) : null };
      if (!d.phone || !d.model) return res.status(400).json({ ok: false, error: "invalid" });
      const code = await createRepair(d);
      let added = [];
      try { added = await autoPrices(q, d.brand, d.model, items); } catch (e) { console.error("auto prix", e && e.message); }
      const used = [];
      try {
        const ids = [...new Set((Array.isArray(b.use_stock) ? b.use_stock : []).map(Number).filter(Number.isInteger))].slice(0, 10);
        for (const sid of ids) {
          const r = (await q`update stock set qty = qty - 1, updated_at = now() where id = ${sid} and qty > 0 returning *`)[0];
          if (r) {
            await q`insert into stock_moves (stock_id, delta, label, note) values (${r.id}, -1, ${r.piece + " " + r.brand + " " + r.model}, ${"Réparation " + code})`;
            used.push({ id: r.id, qty: r.qty });
          }
        }
      } catch (e) { console.error("stock use", e && e.message); }
      await logAct("Nouvelle réparation", `${code} · ${d.brand} ${d.model}`.slice(0, 200));
      return res.status(200).json({ ok: true, code, added, stock_used: used });
    }
    if (b.action === "delete") {
      const id = Number(b.id);
      const cur = (await q`select * from repairs where id = ${id}`)[0];
      if (!cur) return res.status(404).json({ ok: false, error: "notfound" });
      await q`delete from repairs where id = ${id}`;
      const alert = await alertOwner("Réparation SUPPRIMÉE", ["Cette réparation a été supprimée de l'espace atelier."], cur, me);
      await logAct("Réparation supprimée", `${cur.code} · ${cur.name || "client"}`);
      return res.status(200).json({ ok: true, alert });
    }
    if (b.action === "report_now") {
      const r = await sendReport();
      await logAct("Rapport du jour envoyé", null);
      return res.status(r.ok ? 200 : 502).json({ ok: r.ok, count: r.count, error: r.ok ? undefined : "mail_" + r.status });
    }
    if (b.action === "cash_summary") {
      const pub = (d) => ({ sales: d.sales, cost: d.cost, out: d.out, margin: d.margin, solde: d.solde, count: d.count, outs: d.outs,
        rows: d.rows.map((r) => ({ code: r.code, name: r.name, brand: r.brand, model: r.model, piece: r.piece, price: r.price, cost: r.cost, status: r.status, created_at: r.created_at })) });
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || "")) ? String(b.date) : null;
      const day = await periodData("day", date);
      const month = await periodData("month", date);
      return res.status(200).json({ ok: true, date, day: pub(day), month: pub(month) });
    }
    if (b.action === "cash_add") {
      const amount = Math.round(Number(b.amount));
      const reason = one(b.reason, 120);
      if (!Number.isFinite(amount) || amount <= 0 || !reason) return res.status(400).json({ ok: false, error: "invalid" });
      const row = (await q`insert into cash_out (amount, reason) values (${amount}, ${reason}) returning *`)[0];
      await logAct("Sortie de caisse", `${amount} F · ${reason}`);
      return res.status(200).json({ ok: true, row });
    }
    if (b.action === "cash_delete") {
      const id = Number(b.id);
      const cur = (await q`select * from cash_out where id = ${id}`)[0];
      if (!cur) return res.status(404).json({ ok: false, error: "notfound" });
      await q`delete from cash_out where id = ${id}`;
      const alert = await alertCash("Sortie de caisse SUPPRIMÉE", cur);
      await logAct("Sortie de caisse supprimée", `${cur.amount} F · ${cur.reason}`);
      return res.status(200).json({ ok: true, alert });
    }
    if (b.action === "report_month") {
      const r = await sendMonthReport();
      await logAct("Rapport du mois envoyé", null);
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
        await logAct("Prix enregistré", `${p.piece} ${p.label} : ${p.price} F`);
        return res.status(200).json({ ok: true, row: rows[0] });
      } catch (e) {
        if (e && e.code === "23505") return res.status(409).json({ ok: false, error: "exists" });
        throw e;
      }
    }
    if (b.action === "price_delete") {
      await q`delete from prices where id = ${Number(b.id)}`;
      await logAct("Prix supprimé", `id ${Number(b.id)}`);
      return res.status(200).json({ ok: true });
    }
    if (b.action === "stock_list") {
      const rows = await q`select * from stock order by piece, brand, model`;
      const moves = await q`select * from stock_moves order by id desc limit 40`;
      return res.status(200).json({ ok: true, rows, moves });
    }
    if (b.action === "stock_move") {
      const delta = Math.round(Number(b.delta));
      if (!Number.isFinite(delta) || delta === 0 || Math.abs(delta) > 999) return res.status(400).json({ ok: false, error: "invalid" });
      const note = one(b.note, 120) || (delta > 0 ? "Entrée" : "Sortie");
      let row;
      if (b.id) {
        const id = Number(b.id);
        row = (await q`update stock set qty = qty + ${delta}, updated_at = now() where id = ${id} and qty + ${delta} >= 0 returning *`)[0];
        if (!row) {
          const ex = (await q`select id from stock where id = ${id}`)[0];
          return res.status(ex ? 409 : 404).json({ ok: false, error: ex ? "insufficient" : "notfound" });
        }
      } else {
        const piece = one(b.piece, 40), brand = one(b.brand, 40), model = one(b.model, 80);
        if (!piece || !brand || !model || delta < 0) return res.status(400).json({ ok: false, error: "invalid" });
        row = (await q`insert into stock (piece, brand, model, qty) values (${piece}, ${brand}, ${model}, ${delta})
          on conflict (piece, lower(brand), lower(model)) do update set qty = stock.qty + excluded.qty, updated_at = now() returning *`)[0];
      }
      const move = (await q`insert into stock_moves (stock_id, delta, label, note) values (${row.id}, ${delta}, ${row.piece + " " + row.brand + " " + row.model}, ${note}) returning *`)[0];
      await logAct(delta > 0 ? "Entrée en stock" : "Sortie de stock", `${move.label} (${delta > 0 ? "+" : ""}${delta})`);
      return res.status(200).json({ ok: true, row, move });
    }
    if (b.action === "stock_delete") {
      await q`delete from stock where id = ${Number(b.id)}`;
      await logAct("Pièce supprimée du stock", `id ${Number(b.id)}`);
      return res.status(200).json({ ok: true });
    }
    /* ---------- bannières publicitaires ---------- */
    const okLink = (v) => { v = String(v || "").trim(); return /^#[a-z0-9-]{1,30}$/.test(v) || /^https:\/\/[^\s]{4,300}$/.test(v) ? v : ""; };
    const okDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null);
    if (b.action === "banner_list") {
      const rows = await q`select id, alt, link, mime, active, pos, starts, ends, updated_at from banners order by pos, id`;
      return res.status(200).json({ ok: true, rows });
    }
    if (b.action === "banner_save") {
      const alt = one(b.alt, 200), link = okLink(b.link), active = b.active !== false, starts = okDate(b.starts), ends = okDate(b.ends);
      let mime = null, data = null;
      if (b.image) {
        const m = /^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(String(b.image));
        if (!m || m[2].length > 2200000) return res.status(400).json({ ok: false, error: "image" });
        mime = m[1]; data = m[2];
      }
      if (b.id) {
        const id = Number(b.id);
        const r = data
          ? await q`update banners set alt = ${alt}, link = ${link}, active = ${active}, starts = ${starts}, ends = ${ends}, mime = ${mime}, data = ${data}, updated_at = now() where id = ${id} returning id`
          : await q`update banners set alt = ${alt}, link = ${link}, active = ${active}, starts = ${starts}, ends = ${ends}, updated_at = now() where id = ${id} returning id`;
        if (!r[0]) return res.status(404).json({ ok: false, error: "notfound" });
        await logAct("Bannière modifiée", alt || `n° ${id}`);
        return res.status(200).json({ ok: true, id });
      }
      if (!data) return res.status(400).json({ ok: false, error: "image" });
      const pos = Number((await q`select coalesce(max(pos), 0) + 1 as p from banners`)[0].p);
      const r = (await q`insert into banners (alt, link, mime, data, active, pos, starts, ends) values (${alt}, ${link}, ${mime}, ${data}, ${active}, ${pos}, ${starts}, ${ends}) returning id`)[0];
      await logAct("Bannière ajoutée", alt || `n° ${r.id}`);
      return res.status(200).json({ ok: true, id: r.id });
    }
    if (b.action === "banner_order") {
      const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Number.isInteger).slice(0, 50);
      for (let i = 0; i < ids.length; i++) await q`update banners set pos = ${i + 1} where id = ${ids[i]}`;
      return res.status(200).json({ ok: true });
    }
    if (b.action === "banner_delete") {
      const r = (await q`delete from banners where id = ${Number(b.id)} returning alt, id`)[0];
      if (!r) return res.status(404).json({ ok: false, error: "notfound" });
      await logAct("Bannière supprimée", r.alt || `n° ${r.id}`);
      return res.status(200).json({ ok: true });
    }

    /* ---------- gestion de l'équipe (super admin seulement) ---------- */
    if (b.action === "staff_list") {
      const rows = await q`select id, username, name, perms, active, last_login, created_at from staff order by active desc, name`;
      return res.status(200).json({ ok: true, labels: PERMS, rows: rows.map((u) => ({ ...u, perms: parsePerms(u.perms) })) });
    }
    if (b.action === "staff_save") {
      const name = one(b.name, 60), perms = JSON.stringify(cleanPerms(b.perms)), active = b.active !== false;
      if (!name) return res.status(400).json({ ok: false, error: "invalid" });
      if (b.id) {
        const id = Number(b.id);
        const r = (await q`update staff set name = ${name}, perms = ${perms}, active = ${active} where id = ${id} returning id, username`)[0];
        if (!r) return res.status(404).json({ ok: false, error: "notfound" });
        await logAct("Compte staff modifié", `${r.username} : ${active ? "actif" : "désactivé"}, ${cleanPerms(b.perms).length} autorisation(s)`);
        return res.status(200).json({ ok: true });
      }
      const username = String(b.username || "").trim().toLowerCase();
      const pw = String(b.password || "");
      if (!/^[a-z0-9._-]{3,30}$/.test(username) || username === "admin") return res.status(400).json({ ok: false, error: "username" });
      if (pw.length < 6 || pw.length > 100) return res.status(400).json({ ok: false, error: "weak" });
      try {
        await q`insert into staff (username, name, pass_hash, perms, active) values (${username}, ${name}, ${hashPw(pw)}, ${perms}, ${active})`;
      } catch (e) {
        if (e && e.code === "23505") return res.status(409).json({ ok: false, error: "exists" });
        throw e;
      }
      await logAct("Compte staff créé", `${username} (${name})`);
      return res.status(200).json({ ok: true });
    }
    if (b.action === "staff_password") {
      const pw = String(b.password || "");
      if (pw.length < 6 || pw.length > 100) return res.status(400).json({ ok: false, error: "weak" });
      const r = (await q`update staff set pass_hash = ${hashPw(pw)}, fails = 0, locked_until = null where id = ${Number(b.id)} returning username`)[0];
      if (!r) return res.status(404).json({ ok: false, error: "notfound" });
      await logAct("Mot de passe staff réinitialisé", r.username);
      return res.status(200).json({ ok: true });
    }
    if (b.action === "staff_delete") {
      const r = (await q`delete from staff where id = ${Number(b.id)} returning username`)[0];
      if (!r) return res.status(404).json({ ok: false, error: "notfound" });
      await logAct("Compte staff supprimé", r.username);
      return res.status(200).json({ ok: true });
    }
    if (b.action === "staff_log") {
      const rows = await q`select * from staff_log order by id desc limit 120`;
      return res.status(200).json({ ok: true, rows });
    }
    return res.status(400).json({ ok: false, error: "action" });
  } catch (e) {
    console.error("admin error", e && e.message);
    return res.status(500).json({ ok: false, error: "db" });
  }
};
