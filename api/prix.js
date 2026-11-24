const { db, getSettings, promoLive } = require("./_lib");

/* La promotion se règle dans /admin > Réglages (bouton, pourcentage, pièces, dates). Rien à modifier ici. */
const withPromo = (r, p) => {
  if (!p || !(p.pieces.includes("*") || p.pieces.includes(r.piece))) return r;
  const price = Math.round((r.price * (100 - p.pct)) / 100 / p.step) * p.step; // ex. 10000 -> 8000
  return price > 0 && price < r.price ? { ...r, price, old: r.price, promo: p.pct } : r;
};
const scopeText = (p) => {
  if (p.pieces.includes("*")) return "toutes nos réparations";
  if (p.pieces.length === 1 && p.pieces[0] === "Écran") return "tous les écrans";
  return p.pieces.map((x) => x.toLowerCase()).join(", ");
};

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false });
  }
  if (!process.env.DATABASE_URL) return res.status(503).json({ ok: false, error: "config" });
  try {
    const q = await db();
    const s = await getSettings(q);
    const p = promoLive(s.promo) ? s.promo : null;
    const rows = await q`select id, piece, brand, label, quality, price, models from prices order by piece, brand, id`;
    res.setHeader("Cache-Control", "public, s-maxage=20, stale-while-revalidate=60");
    return res.status(200).json({
      ok: true,
      rows: rows.map((r) => withPromo(r, p)),
      promo: p ? { pct: p.pct, text: p.text || `GIGA PROMO : -${p.pct} % sur ${scopeText(p)}. Les prix ci-dessous sont déjà réduits.` } : null,
    });
  } catch (e) {
    console.error("prix error", e && e.message);
    return res.status(500).json({ ok: false, error: "db" });
  }
};
