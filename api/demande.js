const { createRepair } = require("./_lib");

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const one = (s, n = 200) => String(s ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, n);
const multi = (s, n = 800) => String(s ?? "").trim().slice(0, n);
const num = (v, min, max) => {
  const x = Number(v);
  return Number.isFinite(x) && x >= min && x <= max ? x : null;
};

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
  if (b.hp) return res.status(200).json({ ok: true }); // champ piège anti-robot

  const type = ["domicile", "garantie"].includes(b.type) ? b.type : "atelier";
  const domicile = type === "domicile";
  const lookup = type === "garantie";
  const d = {
    name: one(b.name, 80),
    code: one(b.code, 20).toUpperCase(),
    phone: one(b.phone, 30),
    city: one(b.city, 80),
    address: one(b.address, 200),
    brand: one(b.brand, 40),
    model: one(b.model, 80),
    piece: one(b.piece, 40),
    issue: multi(b.issue),
    slot: one(b.slot, 40),
    lat: num(b.lat, -90, 90),
    lng: num(b.lng, -180, 180),
    acc: num(b.acc, 0, 100000),
  };
  const phoneOk = (d.phone.match(/\d/g) || []).length >= 8;
  if (lookup ? !phoneOk || !/^PM-\d{6}$/.test(d.code) : !d.name || !phoneOk || !d.model || !d.issue) {
    return res.status(400).json({ ok: false, error: "invalid" });
  }
  if (domicile && (!d.city || !d.address)) {
    return res.status(400).json({ ok: false, error: "invalid" });
  }
  const apiKey = process.env.RESEND_API_KEY;
  const to = (process.env.NOTIFY_TO || "").trim();
  const from = process.env.MAIL_FROM || "PM Services <onboarding@resend.dev>";
  const hasMail = Boolean(apiKey && to);
  const hasDb = Boolean(process.env.DATABASE_URL);
  if (!hasMail && !hasDb) return res.status(500).json({ ok: false, error: "config" });

  // 1) enregistrement dans le tableau de bord (code de suivi automatique)
  let code = null;
  if (!lookup && hasDb) {
    try {
      code = await createRepair({ kind: type, ...d });
    } catch (e) {
      console.error("db error", e && e.message);
    }
  }

  // 2) e-mail de notification
  const hasGps = d.lat !== null && d.lng !== null;
  const fullAddress = [d.address, d.city].filter(Boolean).join(", ");
  const mapsUrl = hasGps
    ? `https://www.google.com/maps?q=${d.lat},${d.lng}`
    : fullAddress
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`
    : "";
  const digits = d.phone.replace(/\D/g, "");
  const waNumber = digits.length === 10 ? "225" + digits : digits;
  const when = new Date().toLocaleString("fr-FR", { timeZone: "Africa/Abidjan" });
  const kind = domicile ? "à domicile" : "à l’atelier";
  const title = lookup ? "Vérification de garantie" : "Nouvelle demande de réparation " + kind;

  const rows = lookup
    ? [["Type de demande", title], ["Reçue le", when], ["Code", d.code], ["Téléphone", d.phone]]
    : [
        ["Type de demande", "Réparation " + kind],
        ["Reçue le", when],
        ...(code ? [["Code de suivi", code]] : []),
        ["Nom", d.name],
        ["Téléphone", d.phone],
        ["Appareil", `${d.brand} ${d.model}`.trim()],
        ["Pièce", d.piece],
        ["Panne", d.issue],
      ];
  if (domicile) {
    rows.push(["Ville ou commune", d.city], ["Quartier et repère", d.address], ["Passage souhaité", d.slot]);
    if (hasGps) rows.push(["Position GPS", `${d.lat}, ${d.lng}` + (d.acc !== null ? ` (précision environ ${Math.round(d.acc)} m)` : "")]);
  } else if (!lookup) {
    rows.push(["Lieu", "Atelier"]);
  }

  const text =
    rows.map(([k, v]) => `${k} : ${v}`).join("\n") +
    (mapsUrl ? `\n\nOuvrir sur la carte : ${mapsUrl}` : "") +
    `\nAppeler : tel:${digits}\nWhatsApp : https://wa.me/${waNumber}`;
  const html =
    `<div style="font-family:Arial,sans-serif;color:#0a1b3d;max-width:560px">` +
    `<h2 style="color:#0a2a6b;margin:0 0 12px">${esc(title)}</h2>` +
    `<table style="border-collapse:collapse;width:100%">` +
    rows.map(([k, v]) => `<tr><td style="padding:8px;border:1px solid #d4e0f2;background:#eef3fb;font-weight:bold;width:38%">${esc(k)}</td><td style="padding:8px;border:1px solid #d4e0f2">${esc(v).replace(/\n/g, "<br>")}</td></tr>`).join("") +
    `</table><p style="margin-top:16px">` +
    (mapsUrl ? `<a href="${esc(mapsUrl)}" style="background:#0a2a6b;color:#fff;padding:10px 16px;border-radius:20px;text-decoration:none;margin-right:8px">Ouvrir la carte</a>` : "") +
    `<a href="tel:${esc(digits)}" style="background:#1d4fbf;color:#fff;padding:10px 16px;border-radius:20px;text-decoration:none;margin-right:8px">Appeler</a>` +
    `<a href="https://wa.me/${esc(waNumber)}" style="background:#128c4a;color:#fff;padding:10px 16px;border-radius:20px;text-decoration:none">WhatsApp</a></p></div>`;

  let emailed = false;
  let failure = "mail";
  if (hasMail) {
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to: to.split(",").map((x) => x.trim()).filter(Boolean),
          subject: lookup
            ? `Garantie ${d.code} – ${d.phone}`
            : `Réparation ${kind} – ${d.name} – ${`${d.brand} ${d.model}`.trim()}${code ? " – " + code : ""}`,
          text,
          html,
        }),
      });
      emailed = r.ok;
      if (!r.ok) {
        failure = "mail_" + r.status;
        console.error("resend error", r.status, await r.text());
      }
    } catch (e) {
      failure = "mail_network";
      console.error("resend network error", e && e.message);
    }
  } else {
    failure = "config";
  }

  // la demande est réussie si elle est enregistrée OU envoyée par e-mail
  if (!emailed && !code) return res.status(502).json({ ok: false, error: failure });
  return res.status(200).json({ ok: true, code: code || undefined });
};
