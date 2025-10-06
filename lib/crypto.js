// /lib/crypto.js
import crypto from "crypto";

function b64uEncode(buf){ return Buffer.from(buf).toString("base64url"); }
function b64uDecode(str){ return Buffer.from(str, "base64url"); }

const encKey = (()=> {
  const raw = process.env.ENC_KEY_32B || "";
  return raw.startsWith("base64:") ? b64uDecode(raw.slice(7)) : Buffer.from(raw, "base64");
})();
const hmacKey = (()=> {
  const raw = process.env.HMAC_KEY_32B || "";
  return raw.startsWith("base64:") ? b64uDecode(raw.slice(7)) : Buffer.from(raw, "base64");
})();

export function encryptJSON(obj){
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encKey, iv);
  const plaintext = Buffer.from(JSON.stringify(obj), "utf8");
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return b64uEncode(Buffer.concat([iv, tag, enc])); // [12|16|N]
}

export function decryptJSON(packB64u){
  const pack = b64uDecode(packB64u);
  const iv = pack.subarray(0,12);
  const tag = pack.subarray(12,28);
  const enc = pack.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", encKey, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return JSON.parse(dec.toString("utf8"));
}

export function sign(data){
  const h = crypto.createHmac("sha256", hmacKey).update(data).digest();
  return b64uEncode(h);
}

export function verify(data, sigB64u){
  const expected = sign(data);
  return crypto.timingSafeEqual(b64uDecode(expected), b64uDecode(sigB64u||""));
}

// token = base64url(JSON(meta)) + "." + enc + "." + sig
export function createToken(meta, secretPayload){
  const head = b64uEncode(Buffer.from(JSON.stringify(meta)));
  const enc = encryptJSON(secretPayload);
  const toSign = `${head}.${enc}`;
  const sig = sign(toSign);
  return `${head}.${enc}.${sig}`;
}

export function parseToken(token){
  const [headB64u, enc, sig] = (token||"").split(".");
  if(!headB64u || !enc || !sig) throw new Error("Bad token format");
  const ok = verify(`${headB64u}.${enc}`, sig);
  if(!ok) throw new Error("Bad signature");
  const meta = JSON.parse(Buffer.from(headB64u, "base64url").toString("utf8"));
  const payload = decryptJSON(enc);
  return { meta, payload };
}
