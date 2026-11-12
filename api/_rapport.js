const { db, sendMail } = require("./_lib");

const F = (n) => new Intl.NumberFormat("fr-FR").format(n || 0);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ST = { recu: "Reçue", diagnostic: "En diagnostic", piece: "En attente de pièce", cours: "En réparation", pret: "Prête", livre: "Livrée", annule: "Annulée" };

/* rapport du jour (heure d'Abidjan) : réparations créées ou modifiées aujourd'hui */
async function sendReport() {
  const to = (process.env.NOTIFY_TO || "").split(",").map((x) => x.trim()).filter(Boolean);
  if (!to.length) return { ok: false, status: "no_recipient" };
  const q = await db();
  const rows = await q`select * from repairs
    where (updated_at at time zone 'Africa/Abidjan')::date = (now() at time zone 'Africa/Abidjan')::date
    order by created_at`;
  const live = rows.filter((r) => r.status !== "annule");
  const ca = live.reduce((s, r) => s + (r.price || 0), 0);
  const achat = live.reduce((s, r) => s + (r.cost || 0), 0);
  const day = new Date().toLocaleDateString("fr-FR", { timeZone: "Africa/Abidjan", dateStyle: "full" });
  const td = "padding:6px;border:1px solid #d4e0f2;font-size:13px";
  const lines = rows.map((r) =>
    `<tr><td style="${td}">${esc(r.code)}</td><td style="${td}">${esc(r.name || "—")}<br>${esc(r.phone)}</td>` +
    `<td style="${td}">${esc([r.brand, r.model].filter(Boolean).join(" "))}<br><small>${esc(r.piece || "")}</small></td>` +
    `<td style="${td};text-align:right">${F(r.price)}</td><td style="${td};text-align:right">${F(r.cost)}</td>` +
    `<td style="${td};text-align:right">${r.price != null ? F(r.price - (r.cost || 0)) : "—"}</td><td style="${td}">${esc(ST[r.status] || r.status)}</td></tr>`
  ).join("");
  const th = "padding:6px;border:1px solid #d4e0f2;background:#eef3fb;font-size:12px;text-align:left";
  const html = `<div style="font-family:Arial,sans-serif;color:#0a1b3d;max-width:760px">
    <h2 style="color:#0a2a6b;margin:0 0 4px">Rapport du jour – PM Services</h2><p style="margin:0 0 12px;color:#4a6288">${esc(day)}</p>
    <p><b>${rows.length}</b> réparation(s) · Ventes : <b>${F(ca)} F</b> · Achats : ${F(achat)} F · Marge : <b>${F(ca - achat)} F</b></p>
    ${rows.length ? `<table style="border-collapse:collapse;width:100%"><tr><th style="${th}">Code</th><th style="${th}">Client</th><th style="${th}">Appareil</th><th style="${th}">Vente</th><th style="${th}">Achat</th><th style="${th}">Marge</th><th style="${th}">État</th></tr>${lines}</table>` : "<p>Aucune réparation aujourd’hui.</p>"}
    <p style="color:#4a6288;font-size:12px">Annulées exclues des totaux.</p></div>`;
  const text = `Rapport du ${day}\n${rows.length} réparation(s) – Ventes ${F(ca)} F – Achats ${F(achat)} F – Marge ${F(ca - achat)} F\n\n` +
    rows.map((r) => `${r.code} | ${r.name || "—"} | ${[r.brand, r.model].filter(Boolean).join(" ")} | ${r.piece || ""} | vente ${F(r.price)} | achat ${F(r.cost)} | ${ST[r.status] || r.status}`).join("\n");
  const m = await sendMail({ to, subject: `Rapport du jour PM Services – ${rows.length} réparation(s) – ${F(ca)} F`, html, text });
  return { ...m, count: rows.length };
}
module.exports = { sendReport };
