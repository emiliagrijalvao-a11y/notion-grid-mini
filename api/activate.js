// api/activate.js
// Genera un token cifrado con AES-256-GCM que contiene:
// { notionSecret, dbId, bioDbId? } y devuelve una URL con ?token=...
// IMPORTANTE: No imprimir req.url ni el token.

import crypto from "crypto";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method Not Allowed" });
    }

    const { origin } = absoluteOrigin(req);
    const { notionSecret, dbId, bioDbId } = await readJson(req);

    if (!notionSecret || !dbId) {
      return res.status(200).json({ ok: false, error: "Missing notionSecret or dbId" });
    }

    const SECRET_KEY = process.env.SECRET_KEY || "";
    if (!SECRET_KEY || SECRET_KEY.length < 16) {
      return res.status(200).json({ ok: false, error: "Missing SECRET_KEY env" });
    }

    const payload = { notionSecret, dbId, bioDbId: bioDbId || null, iat: Date.now() };
    const token = await encrypt(JSON.stringify(payload), SECRET_KEY);

    const widgetUrl = `${origin}/?token=${encodeURIComponent(token)}`;

    return res.status(200).json({
      ok: true,
      token,
      widgetUrl,
      note: "Comparte este enlace solo con tu cliente. No exponer en público.",
    });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e.message || e) });
  }
}

/* ----------------- utils ----------------- */
async function readJson(req) {
  const raw = await new Promise((r) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => r(data));
  });
  try { return JSON.parse(raw || "{}"); } catch { return {}; }
}

function absoluteOrigin(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  return { origin: `${proto}://${host}` };
}

function b64url(buf) {
  return Buffer.from(buf).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function b64urlToBuf(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  return Buffer.from(str, "base64");
}

async function encrypt(plaintext, secret) {
  // Deriva clave de 32 bytes con scrypt
  const salt = crypto.randomBytes(16);
  const key = await new Promise((resolve, reject) =>
    crypto.scrypt(secret, salt, 32, (err, derived) => (err ? reject(err) : resolve(derived)))
  );
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Formato: v1.salt.iv.ct.tag (todos b64url)
  return ["v1", b64url(salt), b64url(iv), b64url(ct), b64url(tag)].join(".");
}
