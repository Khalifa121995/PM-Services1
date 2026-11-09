const crypto = require("crypto");
const { neon } = require("@neondatabase/serverless");
const SEED = require("./_seed");

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
    (async () => {
      const had = (await q`select to_regclass('public.prices') as t`)[0].t;
      await q`create table if not exists repairs (
        id serial primary key,
        code text unique not null,
        kind text not null default 'atelier',
        name text, phone text not null, email text,
        brand text, model text, piece text, issue text,
        city text, address text, slot text,
        lat double precision, lng double precision,
        status text not null default 'recu',
        price integer, note text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )`;
      await q`alter table repairs add column if not exists email text`;
      await q`create table if not exists prices (
        id serial primary key,
        piece text not null, brand text not null, label text not null,
        quality text, price integer not null, models text,
        updated_at timestamptz not null default now()
      )`;
      await q`create unique index if not exists prices_u on prices (piece, brand, label, (coalesce(quality, '')))`;
      if (!had) {
        // première installation : on charge la liste de prix de départ
        await q.transaction(
          SEED.map((r) => q`insert into prices (piece, brand, label, quality, price, models)
            values (${r.piece}, ${r.brand}, ${r.label}, ${r.quality}, ${r.price}, ${r.models}) on conflict do nothing`)
        );
      }
    })().catch((e) => {
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
      await q`insert into repairs (code, kind, name, phone, email, brand, model, piece, issue, city, address, slot, lat, lng)
        values (${code}, ${d.kind || "atelier"}, ${d.name || null}, ${d.phone}, ${d.email || null}, ${d.brand || null}, ${d.model || null},
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* envoi d'e-mail via Resend */
async function sendMail({ to, subject, html, text }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, status: "config" };
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.MAIL_FROM || "PM Services <onboarding@resend.dev>",
        to: Array.isArray(to) ? to : [to],
        subject, html, text,
      }),
    });
    if (!r.ok) {
      console.error("resend error", r.status, await r.text());
      return { ok: false, status: r.status };
    }
    return { ok: true };
  } catch (e) {
    console.error("resend network error", e && e.message);
    return { ok: false, status: "network" };
  }
}

module.exports = { STATUSES, EMAIL_RE, db, createRepair, sendMail, same, token, isAdmin };
