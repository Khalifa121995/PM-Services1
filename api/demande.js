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

  const domicile = b.type === "domicile";
  const d = {
    name: one(b.name, 80),
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
  if (!d.name || !d.phone || !d.model || !d.issue || (d.phone.match(/\d/g) || []).length < 8) {
    return res.status(400).json({ ok: false, error: "invalid" });
  }
  if (domicile && (!d.city || !d.address)) {
    return res.status(400).json({ ok: false, error: "invalid" });
  }
  const apiKey = process.env.RESEND_API_KEY;
  const to = (process.env.NOTIFY_TO || "").trim();
  if (!apiKey || !to) {
    return res.status(500).json({ ok: false, error: "config" });
  }
  const from = process.env.MAIL_FROM || "PM Services <onboarding@resend.dev>";

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

  const rows = [
    ["Type de demande", "Réparation " + kind],
    ["Reçue le", when],
    ["Nom", d.name],
    ["Téléphone", d.phone],
    ["Appareil", `${d.brand} ${d.model}`.trim()],
    ["Pièce", d.piece],
    ["Panne", d.issue],
  ];
  if (domicile) {
    rows.push(["Ville ou commune", d.city], ["Quartier et repère", d.address], ["Passage souhaité", d.slot]);
    if (hasGps) rows.push(["Position GPS", `${d.lat}, ${d.lng}` + (d.acc !== null ? ` (précision environ ${Math.round(d.acc)} m)` : "")]);
  } else {
    rows.push(["Lieu", "Atelier"]);
  }

  const text =
    rows.map(([k, v]) => `${k} : ${v}`).join("\n") +
    (mapsUrl ? `\n\nOuvrir sur la carte : ${mapsUrl}` : "") +
    `\nAppeler : tel:${digits}\nWhatsApp : https://wa.me/${waNumber}`;

  const html =
    `<div style="font-family:Arial,sans-serif;color:#0a1b3d;max-width:560px">` +
    `<h2 style="color:#0a2a6b;margin:0 0 12px">Nouvelle demande de réparation ${esc(kind)}</h2>` +
    `<table style="border-collapse:collapse;width:100%">` +
    rows.map(([k, v]) => `<tr><td style="padding:8px;border:1px solid #d4e0f2;background:#eef3fb;font-weight:bold;width:38%">${esc(k)}</td><td style="padding:8px;border:1px solid #d4e0f2">${esc(v).replace(/\n/g, "<br>")}</td></tr>`).join("") +
    `</table><p style="margin-top:16px">` +
    (mapsUrl ? `<a href="${esc(mapsUrl)}" style="background:#0a2a6b;color:#fff;padding:10px 16px;border-radius:20px;text-decoration:none;margin-right:8px">Ouvrir la carte</a>` : "") +
    `<a href="tel:${esc(digits)}" style="background:#1d4fbf;color:#fff;padding:10px 16px;border-radius:20px;text-decoration:none;margin-right:8px">Appeler</a>` +
    `<a href="https://wa.me/${esc(waNumber)}" style="background:#128c4a;color:#fff;padding:10px 16px;border-radius:20px;text-decoration:none">WhatsApp</a></p></div>`;

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: to.split(",").map((x) => x.trim()).filter(Boolean),
        subject: `Réparation ${kind} – ${d.name} – ${`${d.brand} ${d.model}`.trim()}`,
        text,
        html,
      }),
    });
    if (!r.ok) {
      console.error("resend error", r.status, await r.text());
      return res.status(502).json({ ok: false, error: "mail_" + r.status });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("resend network error", e && e.message);
    return res.status(502).json({ ok: false, error: "mail_network" });
  }
};
