// /api/activate.js
import { getActiveLicenseByEmailAndId, createWidget } from "../lib/db.js";
import { createToken } from "../lib/crypto.js";

function shortId(){
  const abc = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-";
  let s=""; for(let i=0;i<6;i++) s += abc[Math.floor(Math.random()*abc.length)];
  return s;
}

export default async function handler(req, res){
  try{
    if(req.method !== "POST"){
      return res.status(200).json({ ok:false, error:"POST only" });
    }
    const { email, license, notion_secret, db_id, bio_db_id } = req.body || {};
    if(!email || !license || !notion_secret || !db_id){
      return res.status(200).json({ ok:false, error:"Missing fields" });
    }
    const lic = await getActiveLicenseByEmailAndId(email.toLowerCase(), license);
    if(!lic) return res.status(200).json({ ok:false, error:"License not found or inactive" });

    const wid = shortId();
    await createWidget({ id: wid, license_id: lic.id, email: lic.email, db_id, bio_db_id: bio_db_id || null });

    // Meta visible + payload secreto
    const meta = { ver:"v1", wid, lic: lic.id, aud:"widget" };
    const payload = { notion_secret, db_id, bio_db_id: bio_db_id || null };

    const token = createToken(meta, payload);
    const base = process.env.SITE_BASE_URL || `https://${req.headers.host}`;
    const widgetUrl = `${base}/?token=${encodeURIComponent(token)}`;

    res.status(200).json({ ok:true, widgetUrl, token, wid });
  }catch(e){
    res.status(200).json({ ok:false, error:String(e.message||e) });
  }
}
