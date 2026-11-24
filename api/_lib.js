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
      await q`alter table repairs add column if not exists cost integer`;
      await q`alter table repairs add column if not exists items text`;
      await q`alter table repairs add column if not exists source text`;
      // anciens dossiers : à domicile => commandé en ligne ; avec détail des pièces => saisi à l'atelier
      await q`update repairs set source = 'en_ligne' where source is null and kind = 'domicile'`;
      await q`update repairs set source = 'atelier' where source is null and items is not null`;
      await q`create table if not exists cash_out (
        id serial primary key,
        amount integer not null,
        reason text not null,
        created_at timestamptz not null default now()
      )`;
      await q`create table if not exists prices (
        id serial primary key,
        piece text not null, brand text not null, label text not null,
        quality text, price integer not null, models text,
        updated_at timestamptz not null default now()
      )`;
      await q`create unique index if not exists prices_u on prices (piece, brand, label, (coalesce(quality, '')))`;
      await q`create table if not exists stock (
        id serial primary key,
        piece text not null, brand text not null, model text not null,
        qty integer not null default 0,
        updated_at timestamptz not null default now()
      )`;
      await q`create unique index if not exists stock_u on stock (piece, lower(brand), lower(model))`;
      await q`create table if not exists stock_moves (
        id serial primary key,
        stock_id integer, delta integer not null, label text not null, note text,
        created_at timestamptz not null default now()
      )`;
      await q`create table if not exists staff (
        id serial primary key,
        username text unique not null,
        name text not null,
        pass_hash text not null,
        perms text not null default '[]',
        active boolean not null default true,
        fails integer not null default 0,
        locked_until timestamptz,
        last_login timestamptz,
        created_at timestamptz not null default now()
      )`;
      await q`alter table staff add column if not exists email text`;
      await q`alter table staff add column if not exists reset_hash text`;
      await q`alter table staff add column if not exists reset_exp timestamptz`;
      await q`alter table staff add column if not exists reset_tries integer not null default 0`;
      await q`create table if not exists staff_log (
        id serial primary key,
        actor_id integer, actor_name text not null,
        action text not null, detail text,
        created_at timestamptz not null default now()
      )`;
      await q`create table if not exists banners (
        id serial primary key,
        alt text not null default '',
        link text not null default '',
        mime text not null,
        data text not null,
        active boolean not null default true,
        pos integer not null default 0,
        starts date, ends date,
        updated_at timestamptz not null default now()
      )`;
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
      await q`insert into repairs (code, kind, source, name, phone, email, brand, model, piece, issue, city, address, slot, lat, lng, price, cost, items)
        values (${code}, ${d.kind || "atelier"}, ${d.source || "atelier"}, ${d.name || null}, ${d.phone}, ${d.email || null}, ${d.brand || null}, ${d.model || null},
        ${d.piece || null}, ${d.issue || null}, ${d.city || null}, ${d.address || null}, ${d.slot || null},
        ${d.lat ?? null}, ${d.lng ?? null}, ${d.price ?? null}, ${d.cost ?? null}, ${d.items ?? null})`;
      return code;
    } catch (e) {
      if (e && e.code === "23505") continue;
      throw e;
    }
  }
  throw new Error("code_conflict");
}

/* ---- permissions des comptes staff (le super admin les accorde une par une) ---- */
const PERMS = {
  create: "Enregistrer une nouvelle réparation",
  update: "Changer l’état d’une réparation et écrire des notes",
  edit_price: "Modifier le prix client d’une réparation",
  cost: "Voir et modifier les prix d’achat et les marges",
  archives: "Voir les archives (réparations livrées ou annulées)",
  delete: "Supprimer une réparation",
  prices: "Voir et modifier la liste des prix",
  stock: "Gérer le stock de l’atelier",
  cash: "Accéder à la caisse (solde, sorties d’argent)",
  reports: "Envoyer les rapports par e-mail",
  banners: "Gérer les bannières publicitaires du site",
};
const PERM_KEYS = Object.keys(PERMS);
const cleanPerms = (a) => PERM_KEYS.filter((k) => Array.isArray(a) && a.includes(k));
const parsePerms = (t) => {
  try { return cleanPerms(JSON.parse(t || "[]")); } catch { return []; }
};

/* ---- mots de passe du staff : scrypt + sel ---- */
const hashPw = (pw) => {
  const salt = crypto.randomBytes(16).toString("hex");
  return "scrypt$" + salt + "$" + crypto.scryptSync(String(pw), salt, 32).toString("hex");
};
const checkPw = (pw, stored) => {
  const [alg, salt, hex] = String(stored || "").split("$");
  if (alg !== "scrypt" || !salt || !hex) return false;
  const a = crypto.scryptSync(String(pw), salt, 32);
  const b = Buffer.from(hex, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const DUMMY_HASH = hashPw("dummy-pour-egaliser-le-temps");

/* ---- session : cookie signé, valable 12 h.
   Super admin = mot de passe ADMIN_PASSWORD (Vercel). Staff = compte en base ; ses droits sont relus en base à chaque requête. ---- */
const key = () =>
  crypto.createHash("sha256").update("pm|" + (process.env.ADMIN_PASSWORD || "") + "|" + (process.env.DATABASE_URL || "")).digest();
const mac = (v) => crypto.createHmac("sha256", key()).update(v).digest("hex");
const h256 = (s) => crypto.createHash("sha256").update(String(s)).digest();
const same = (a, b) => crypto.timingSafeEqual(h256(a), h256(b));
const token = (role = "super", id = 0) => {
  const body = Buffer.from(JSON.stringify({ r: role, id, exp: Date.now() + 12 * 3600 * 1000 })).toString("base64url");
  return "v2." + body + "." + mac(body);
};
const readCookie = (req) => {
  const m = /(?:^|;\s*)pm_admin=([^;]+)/.exec(req.headers.cookie || "");
  if (!m) return null;
  const [v, body, sig] = m[1].split(".");
  if (v !== "v2" || !body || !sig || !same(sig, mac(body))) return null;
  try {
    const d = JSON.parse(Buffer.from(body, "base64url").toString());
    return d && Number(d.exp) > Date.now() ? d : null;
  } catch { return null; }
};
/* retourne { role: "super"|"staff", id, name, username, perms } ou null */
async function getSession(req, q) {
  if (!process.env.ADMIN_PASSWORD) return null;
  const c = readCookie(req);
  if (!c) return null;
  if (c.r === "super") return { role: "super", id: 0, name: "Super admin", username: "admin", perms: PERM_KEYS.slice() };
  if (c.r === "staff") {
    const u = (await q`select id, username, name, perms, active from staff where id = ${Number(c.id)}`)[0];
    if (!u || !u.active) return null;
    return { role: "staff", id: u.id, name: u.name, username: u.username, perms: parsePerms(u.perms) };
  }
  return null;
}
const isAdmin = (req) => !!readCookie(req);

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

module.exports = { STATUSES, EMAIL_RE, PERMS, PERM_KEYS, cleanPerms, parsePerms, hashPw, checkPw, DUMMY_HASH, getSession, db, createRepair, sendMail, same, token, isAdmin };
