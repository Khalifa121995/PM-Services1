const { db, sendMail } = require("./_lib");

const TZ = "Africa/Abidjan";
const F = (n) => new Intl.NumberFormat("fr-FR").format(n || 0);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ST = { recu: "Reçue", diagnostic: "En diagnostic", piece: "En attente de pièce", cours: "En réparation", pret: "Prête", livre: "Livrée", annule: "Annulée" };
const SRC = { en_ligne: "🌐 En ligne", atelier: "🏪 Atelier" };
const dayKey = (d) => new Date(d).toLocaleDateString("en-CA", { timeZone: TZ }); // AAAA-MM-JJ
const recipients = () => (process.env.NOTIFY_TO || "").split(",").map((x) => x.trim()).filter(Boolean);

/* Données d'une période : "day" = aujourd'hui, "month" = mois en cours (heure d'Abidjan).
   Jour : réparations créées ou modifiées aujourd'hui. Mois : réparations créées ce mois.
   Solde = Ventes − Achats − Sorties de caisse (réparations annulées exclues). */
async function periodData(period) {
  const q = await db();
  let rows, outs;
  if (period === "day") {
    rows = await q`select * from repairs
      where (updated_at at time zone 'Africa/Abidjan')::date = (now() at time zone 'Africa/Abidjan')::date order by created_at`;
    outs = await q`select * from cash_out
      where (created_at at time zone 'Africa/Abidjan')::date = (now() at time zone 'Africa/Abidjan')::date order by created_at`;
  } else {
    rows = await q`select * from repairs
      where date_trunc('month', created_at at time zone 'Africa/Abidjan') = date_trunc('month', now() at time zone 'Africa/Abidjan') order by created_at`;
    outs = await q`select * from cash_out
      where date_trunc('month', created_at at time zone 'Africa/Abidjan') = date_trunc('month', now() at time zone 'Africa/Abidjan') order by created_at`;
  }
  const live = rows.filter((r) => r.status !== "annule");
  const sales = live.reduce((s, r) => s + (r.price || 0), 0);
  const cost = live.reduce((s, r) => s + (r.cost || 0), 0);
  const out = outs.reduce((s, o) => s + (o.amount || 0), 0);
  return { rows, live, outs, sales, cost, out, margin: sales - cost, solde: sales - cost - out, count: live.length };
}

const td = "padding:6px;border:1px solid #d4e0f2;font-size:13px";
const th = "padding:6px;border:1px solid #d4e0f2;background:#eef3fb;font-size:12px;text-align:left";

function totalsHtml(d, label) {
  const line = (k, v, bold) => `<tr><td style="${td}">${k}</td><td style="${td};text-align:right${bold ? ";font-weight:bold;font-size:15px;background:#eef3fb" : ""}">${v}</td></tr>`;
  return `<table style="border-collapse:collapse;width:100%;max-width:380px;margin:8px 0">
    ${line("Ventes", F(d.sales) + " F")}${line("Achats", F(d.cost) + " F")}${line("Marge", F(d.margin) + " F")}
    ${line("Sorties de caisse", "− " + F(d.out) + " F")}${line(label, F(d.solde) + " F", true)}</table>`;
}
function repairsHtml(rows) {
  if (!rows.length) return "<p>Aucune réparation.</p>";
  const lines = rows.map((r) =>
    `<tr><td style="${td}">${esc(r.code)}<br><small>${esc(SRC[r.source] || "")}</small></td><td style="${td}">${esc(r.name || "—")}<br>${esc(r.phone)}</td>` +
    `<td style="${td}">${esc([r.brand, r.model].filter(Boolean).join(" "))}<br><small>${esc(r.piece || "")}</small></td>` +
    `<td style="${td};text-align:right">${F(r.price)}</td><td style="${td};text-align:right">${F(r.cost)}</td>` +
    `<td style="${td};text-align:right">${r.price != null ? F(r.price - (r.cost || 0)) : "—"}</td><td style="${td}">${esc(ST[r.status] || r.status)}</td></tr>`
  ).join("");
  return `<table style="border-collapse:collapse;width:100%"><tr><th style="${th}">Code</th><th style="${th}">Client</th><th style="${th}">Appareil</th><th style="${th}">Vente</th><th style="${th}">Achat</th><th style="${th}">Marge</th><th style="${th}">État</th></tr>${lines}</table>`;
}
function outsHtml(outs) {
  if (!outs.length) return "<p>Aucune sortie de caisse.</p>";
  const lines = outs.map((o) =>
    `<tr><td style="${td}">${esc(new Date(o.created_at).toLocaleString("fr-FR", { timeZone: TZ, dateStyle: "short", timeStyle: "short" }))}</td><td style="${td}">${esc(o.reason)}</td><td style="${td};text-align:right">− ${F(o.amount)} F</td></tr>`
  ).join("");
  return `<table style="border-collapse:collapse;width:100%"><tr><th style="${th}">Date</th><th style="${th}">Motif</th><th style="${th}">Montant</th></tr>${lines}</table>`;
}
const repairsText = (rows) => rows.map((r) => `${r.code} | ${r.name || "—"} | ${[r.brand, r.model].filter(Boolean).join(" ")} | ${r.piece || ""} | vente ${F(r.price)} | achat ${F(r.cost)} | ${ST[r.status] || r.status}`).join("\n");
const outsText = (outs) => outs.map((o) => `- ${o.reason} : ${F(o.amount)} F`).join("\n");

/* rapport du jour */
async function sendReport() {
  const to = recipients();
  if (!to.length) return { ok: false, status: "no_recipient" };
  const d = await periodData("day");
  const day = new Date().toLocaleDateString("fr-FR", { timeZone: TZ, dateStyle: "full" });
  const html = `<div style="font-family:Arial,sans-serif;color:#0a1b3d;max-width:760px">
    <h2 style="color:#0a2a6b;margin:0 0 4px">Rapport du jour – PM Services</h2><p style="margin:0 0 12px;color:#4a6288">${esc(day)}</p>
    <p><b>${d.rows.length}</b> réparation(s)</p>
    ${totalsHtml(d, "Solde de la journée")}
    <h3 style="color:#0a2a6b">Réparations</h3>${repairsHtml(d.rows)}
    <h3 style="color:#0a2a6b">Sorties de caisse</h3>${outsHtml(d.outs)}
    <p style="color:#4a6288;font-size:12px">Annulées exclues des totaux. Solde = ventes − achats − sorties de caisse.</p></div>`;
  const text = `Rapport du ${day}\n${d.rows.length} réparation(s)\nVentes ${F(d.sales)} F – Achats ${F(d.cost)} F – Marge ${F(d.margin)} F – Sorties de caisse ${F(d.out)} F\nSOLDE DE LA JOURNÉE : ${F(d.solde)} F\n\n${repairsText(d.rows)}\n\nSorties de caisse :\n${outsText(d.outs) || "aucune"}`;
  const m = await sendMail({ to, subject: `Rapport du jour PM Services – ${d.rows.length} réparation(s) – solde ${F(d.solde)} F`, html, text });
  return { ...m, count: d.rows.length };
}

/* rapport du mois (envoyé le dernier jour du mois, ou à la demande) */
async function sendMonthReport() {
  const to = recipients();
  if (!to.length) return { ok: false, status: "no_recipient" };
  const d = await periodData("month");
  const label = new Date().toLocaleDateString("fr-FR", { timeZone: TZ, month: "long", year: "numeric" });
  // détail jour par jour
  const days = {};
  const slot = (k) => (days[k] = days[k] || { n: 0, sales: 0, cost: 0, out: 0 });
  d.live.forEach((r) => { const s = slot(dayKey(r.created_at)); s.n++; s.sales += r.price || 0; s.cost += r.cost || 0; });
  d.outs.forEach((o) => { slot(dayKey(o.created_at)).out += o.amount || 0; });
  const dayRows = Object.keys(days).sort().map((k) => {
    const s = days[k];
    return `<tr><td style="${td}">${esc(k.split("-").reverse().join("/"))}</td><td style="${td};text-align:right">${s.n}</td><td style="${td};text-align:right">${F(s.sales)}</td><td style="${td};text-align:right">${F(s.cost)}</td><td style="${td};text-align:right">${F(s.out)}</td><td style="${td};text-align:right"><b>${F(s.sales - s.cost - s.out)}</b></td></tr>`;
  }).join("");
  // origine : en ligne / atelier
  const by = (src) => d.live.filter((r) => (src ? r.source === src : !r.source));
  const origin = [["🌐 Commandées en ligne", by("en_ligne")], ["🏪 Enregistrées à l'atelier", by("atelier")], ["Origine non précisée", by(null)]]
    .filter(([, l]) => l.length)
    .map(([k, l]) => `<li>${k} : <b>${l.length}</b> · ventes ${F(l.reduce((s, r) => s + (r.price || 0), 0))} F</li>`).join("");
  const byStatus = Object.keys(ST).map((k) => [ST[k], d.rows.filter((r) => r.status === k).length]).filter(([, n]) => n)
    .map(([k, n]) => `${esc(k)} : ${n}`).join(" · ");
  const html = `<div style="font-family:Arial,sans-serif;color:#0a1b3d;max-width:780px">
    <h2 style="color:#0a2a6b;margin:0 0 4px">Rapport du mois – PM Services</h2><p style="margin:0 0 12px;color:#4a6288;text-transform:capitalize">${esc(label)}</p>
    <p><b>${d.rows.length}</b> réparation(s) enregistrée(s) ce mois (dont ${d.rows.length - d.live.length} annulée(s))</p>
    ${totalsHtml(d, "Solde du mois")}
    ${origin ? `<ul>${origin}</ul>` : ""}${byStatus ? `<p style="color:#4a6288">${byStatus}</p>` : ""}
    <h3 style="color:#0a2a6b">Jour par jour</h3>
    ${dayRows ? `<table style="border-collapse:collapse;width:100%"><tr><th style="${th}">Jour</th><th style="${th}">Réparations</th><th style="${th}">Ventes</th><th style="${th}">Achats</th><th style="${th}">Sorties</th><th style="${th}">Solde</th></tr>${dayRows}</table>` : "<p>Aucune activité.</p>"}
    <h3 style="color:#0a2a6b">Sorties de caisse du mois</h3>${outsHtml(d.outs)}
    <h3 style="color:#0a2a6b">Toutes les réparations du mois</h3>${repairsHtml(d.rows)}
    <p style="color:#4a6288;font-size:12px">Annulées exclues des totaux. Solde = ventes − achats − sorties de caisse.</p></div>`;
  const text = `Rapport du mois – ${label}\n${d.rows.length} réparation(s)\nVentes ${F(d.sales)} F – Achats ${F(d.cost)} F – Marge ${F(d.margin)} F – Sorties de caisse ${F(d.out)} F\nSOLDE DU MOIS : ${F(d.solde)} F\n\nSorties de caisse :\n${outsText(d.outs) || "aucune"}\n\n${repairsText(d.rows)}`;
  const m = await sendMail({ to, subject: `Rapport du mois PM Services – ${label} – solde ${F(d.solde)} F`, html, text });
  return { ...m, count: d.rows.length };
}

module.exports = { sendReport, sendMonthReport, periodData };
