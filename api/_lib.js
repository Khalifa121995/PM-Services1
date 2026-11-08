const crypto = require("crypto");
const { neon } = require("@neondatabase/serverless");

const STATUSES = {
  recu: "Reçue",
  diagnostic: "En diagnostic",
  piece: "En attente de pièce",
  cours: "En réparation",
  pret: "Prête à récupérer",
  livre: "Livrée",
  annule: "Annulée",
};

let sqlFn = null;
let ready = null;

async function db() {
  if (!process.env.DATABASE_URL) throw new Error("no_db");
  sqlFn = sqlFn || neon(process.env.DATABASE_URL);
  const q = sqlFn;
  ready =
    ready ||
    q`create table if not exists repairs (
      id serial primary key,
      code text unique not null,
      kind text not null default 'atelier',
      name text, phone text not null,
      brand text, model text, piece text, issue text,
      city text, address text, slot text,
      lat double precision, lng double precision,
      status text not null default 'recu',
      price integer, note text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )`.catch((e) => {
      ready = null;
      throw e;
    });
  await ready;
  return q;
}

async function createRepair(d) {
  const q = await db();
  for (let i = 0; i < 6; i++) {
    const code = "PM-" + crypto.randomInt(100000, 1000000);
    try {
      await q`insert into repairs (code, kind, name, phone, brand, model, piece, issue, city, address, slot, lat, lng)
        values (${code}, ${d.kind || "atelier"}, ${d.name || null}, ${d.phone}, ${d.brand || null}, ${d.model || null},
        ${d.piece || null}, ${d.issue || null}, ${d.city || null}, ${d.address || null}, ${d.slot || null},
        ${d.lat ?? null}, ${d.lng ?? null})`;
      return code;
    } catch (e) {
      if (e && e.code === "23505") continue;
      throw e;
    }
  }
  throw new Error("code_conflict");
}

/* session admin : cookie signé, valable 12 h */
const key = () =>
  crypto.createHash("sha256").update("pm|" + (process.env.ADMIN_PASSWORD || "") + "|" + (process.env.DATABASE_URL || "")).digest();
const mac = (v) => crypto.createHmac("sha256", key()).update(v).digest("hex");
const h256 = (s) => crypto.createHash("sha256").update(String(s)).digest();
const same = (a, b) => crypto.timingSafeEqual(h256(a), h256(b));
const token = () => {
  const exp = String(Date.now() + 12 * 3600 * 1000);
  return exp + "." + mac(exp);
};
const isAdmin = (req) => {
  if (!process.env.ADMIN_PASSWORD) return false;
  const m = /(?:^|;\s*)pm_admin=([^;]+)/.exec(req.headers.cookie || "");
  if (!m) return false;
  const [exp, sig] = m[1].split(".");
  return !!sig && Number(exp) > Date.now() && same(sig, mac(exp));
};

module.exports = { STATUSES, db, createRepair, same, token, isAdmin };
