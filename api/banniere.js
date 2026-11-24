const { db } = require("./_lib");

/* image d'une bannière : /api/banniere?id=3&v=... (v change à chaque nouvelle image, donc cache long) */
module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end();
  }
  const id = Number(req.query && req.query.id);
  if (!Number.isInteger(id) || !process.env.DATABASE_URL) return res.status(404).end();
  try {
    const q = await db();
    const r = (await q`select mime, data from banners where id = ${id}`)[0];
    if (!r) return res.status(404).end();
    res.setHeader("Content-Type", r.mime);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.status(200).send(Buffer.from(r.data, "base64"));
  } catch (e) {
    console.error("banniere error", e && e.message);
    return res.status(500).end();
  }
};
