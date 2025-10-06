// /api/activate.js  — genera magic-link (?w=...) sin tocar tu UI
import crypto from "node:crypto";

const SITE = process.env.SITE_BASE_URL || "https://notion-grid-mini.vercel.app";

// Helpers base64url
const b64u = {
  enc: (buf) => Buffer.from(buf).toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""),
  dec: (str) => Buffer.from(str.replace(/-/g,"+").replace(/_/g,"/"), "base64"),
};

// Cifra {nt,db,bio,exp} con AES-256-GCM + HMAC-SHA256
function encryptPayload(payloadStr) {
  const encKeyB64 = process.env.ENC_KEY_32B;   // openssl rand -base64 32
  const macKeyB64 = process.env.HMAC_KEY_32B;  // openssl rand -base64 32
  if (!encKeyB64 || !macKeyB64) throw new Error("Missing ENC_KEY_32B / HMAC_KEY_32B");

  const encKey = b64u.dec(encKeyB64);
  const macKey = b64u.dec(macKeyB64);

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encKey, iv);
  const ciphertext = Buffer.concat([cipher.update(payloadStr, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  // mac = HMAC(iv.cipher.tag)
  const mac = crypto.createHmac("sha256", macKey).update(Buffer.concat([iv, ciphertext, tag])).digest();

  // token v1.iv.ct.tag.mac (base64url)
  const token = ["v1", b64u.enc(iv), b64u.enc(ciphertext), b64u.enc(tag), b64u.enc(mac)].join(".");
  return token;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(200).json({ ok:false, error:"Use POST JSON {email, notionToken, dbId, bioDb?}" });
    }
    const body = await readJson(req);
    const email = String(body.email || "").trim();
    const nt    = String(body.notionToken || "").trim();
    const db    = String(body.dbId || "").trim();
    const bio   = (body.bioDb || "").trim();

    if (!nt || !db) return res.status(200).json({ ok:false, error:"Missing notionToken or dbId" });

    // expira en 180 días (puedes ajustar)
    const exp = Date.now() + 180*24*60*60*1000;

    const payload = JSON.stringify({ nt, db, bio, exp, email });
    const w = encryptPayload(payload);

    // URL de widget (listo para embeber en Notion)
    const widgetUrl = `${SITE}/?w=${encodeURIComponent(w)}`;
    return res.status(200).json({ ok:true, widgetUrl });
  } catch (err) {
    console.error(err);
    res.status(200).json({ ok:false, error:String(err.message || err) });
  }
}

// --- util para leer JSON crudo (sin body-parser) ---
function readJson(req){
  return new Promise((resolve, reject)=>{
    let data = "";
    req.on("data", ch => data += ch);
    req.on("end", ()=> {
      try { resolve(JSON.parse(data || "{}")); }
      catch(e){ reject(e); }
    });
    req.on("error", reject);
  });
}
