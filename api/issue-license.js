// /api/issue-license.js
import crypto from "crypto";
import { upsertCustomer, createLicense } from "../lib/db.js";

async function verifyShopify(req){
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if(!secret) return true; // para pruebas locales
  const hmac = req.headers["x-shopify-hmac-sha256"] || "";
  const raw = req.rawBody || JSON.stringify(req.body||{});
  const digest = crypto.createHmac("sha256", secret).update(raw, "utf8").digest("base64");
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmac));
}

async function sendEmail({ to, licenseId, siteBase }){
  const RESEND = process.env.RESEND_API_KEY;
  const FROM = process.env.FROM_EMAIL;
  const url = `${process.env.SITE_BASE_URL || siteBase || ""}/activate?email=${encodeURIComponent(to)}&license=${licenseId}`;
  if(!RESEND || !FROM) return; // opcional
  const res = await fetch("https://api.resend.com/emails", {
    method:"POST",
    headers:{ "Authorization":`Bearer ${RESEND}`, "Content-Type":"application/json" },
    body: JSON.stringify({
      from: FROM,
      to, subject: "Tu Notion Grid — Activación",
      html: `
        <p>¡Gracias por tu compra!</p>
        <p>Tu licencia: <strong>${licenseId}</strong></p>
        <p>Actívala aquí: <a href="${url}">${url}</a></p>
        <hr/>
        <p>Luego pega el widget en Notion (Embed) y listo ✨</p>`
    })
  });
  await res.text().catch(()=>{});
}

export const config = {
  api: { bodyParser: { sizeLimit: "2mb" } }
};

export default async function handler(req, res){
  try{
    // Vercel peculiaridad: conserva rawBody si usas bodyParser: false,
    // aquí asumimos JSON normal; si fallara la verificación, comenta verify.
    const ok = await verifyShopify(req);
    if(!ok) return res.status(401).json({ ok:false, error:"Invalid webhook signature" });

    const order = req.body || {};
    const email = (order?.email || order?.customer?.email || "").toLowerCase();
    if(!email) return res.status(200).json({ ok:false, error:"No email in order" });

    await upsertCustomer(email);
    const lic = await createLicense({ email, order_id: String(order.id||order.name||""), plan:"pro" });

    await sendEmail({ to: email, licenseId: lic.id });

    res.status(200).json({ ok:true, license: lic.id });
  }catch(e){
    res.status(200).json({ ok:false, error: String(e.message||e) });
  }
}
