import { Client } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DB = process.env.NOTION_DATABASE_ID;

// Utilidades para encontrar propiedades por nombre (case-insensitive)
const findKey = (props, candidates) =>
  Object.keys(props || {}).find(k =>
    candidates.some(c => k.trim().toLowerCase() === c));

const textOut = (rt = []) => rt.map(t => t.plain_text || "").join("").trim();

const isVideoUrl = (u = "") => /\.(mp4|webm|mov|m4v)(\?|$)/i.test(u);

function pickProps(page){
  const p = page.properties || {};

  const titleKey   = findKey(p, ["name","title"]);
  const dateKey    = findKey(p, ["publish date","date"]);
  const platKey    = findKey(p, ["platform","platforms"]);
  const statusKey  = findKey(p, ["status"]);
  const capKey     = findKey(p, ["caption","text"]);
  const attachKey  = findKey(p, ["attachment","image","files"]);
  const linkKey    = findKey(p, ["link","url"]);
  const srcKey     = findKey(p, ["image source","source"]);
  const pinKey     = findKey(p, ["pinned","pin"]);
  const hideKey    = findKey(p, ["hide","hidden","archive","archived"]);

  const title  = titleKey  ? textOut(p[titleKey].title) : "";
  const date   = dateKey   ? (p[dateKey].date?.start || null) : null;
  const caption= capKey    ? textOut(p[capKey].rich_text) : "";
  const status = statusKey ? (p[statusKey].select?.name || null) : null;
  const platforms = platKey ? (p[platKey].multi_select || []).map(x => x.name) : [];
  const pinned = pinKey ? !!p[pinKey].checkbox : false;
  const hidden = hideKey ? !!p[hideKey].checkbox : false;
  const imgSrcPref = srcKey ? (p[srcKey].select?.name || "").toLowerCase() : "";

  // Link / Attachment / Cover
  const linkUrl = linkKey ? (p[linkKey].url || "") : "";
  const files   = attachKey ? (p[attachKey].files || []) : [];
  const fileUrl = files[0]?.file?.url || files[0]?.external?.url || "";
  const cover   = page.cover?.file?.url || page.cover?.external?.url || "";

  // Selección de media (4:5)
  let mediaUrl = "";
  let kind = "image";

  if (imgSrcPref === "link" && linkUrl){
    mediaUrl = linkUrl; kind = isVideoUrl(linkUrl) ? "video" : "image";
  } else if (imgSrcPref === "image attachment" && fileUrl){
    mediaUrl = fileUrl; kind = isVideoUrl(fileUrl) ? "video" : "image";
  } else if (fileUrl){
    mediaUrl = fileUrl; kind = isVideoUrl(fileUrl) ? "video" : "image";
  } else if (linkUrl){
    mediaUrl = linkUrl; kind = isVideoUrl(linkUrl) ? "video" : "image";
  } else if (cover){
    mediaUrl = cover; kind = "image";
  }

  return {
    id: page.id,
    title,
    publishDate: date,
    caption,
    platforms,
    status,
    pinned,
    hidden,
    media: mediaUrl ? { kind, url: mediaUrl } : null,
  };
}

async function fetchAll(databaseId){
  let results = [];
  let cursor = undefined;
  do{
    const rsp = await notion.databases.query({
      database_id: databaseId,
      page_size: 100,
      start_cursor: cursor,
    });
    results.push(...rsp.results);
    cursor = rsp.has_more ? rsp.next_cursor : undefined;
  } while(cursor);
  return results;
}

export default async function handler(req, res){
  try{
    if (!process.env.NOTION_TOKEN || !DB){
      res.status(500).json({ ok:false, error:"Missing NOTION_TOKEN or NOTION_DATABASE_ID" });
      return;
    }

    const { platform = "", status = "", limit = "12" } = req.query || {};
    const wantPlatforms = platform ? platform.split(",").map(s=>s.trim().toLowerCase()).filter(Boolean) : [];
    const wantStatus    = status ? status.split(",").map(s=>s.trim().toLowerCase()).filter(Boolean) : [];
    const LIM = Math.max(1, Math.min(60, parseInt(limit,10) || 12)); // tope 60

    const pages = await fetchAll(DB);
    let items = pages.map(pickProps);

    // Filtrar ocultos
    items = items.filter(it => !it.hidden);

    // Filtrar por platform / status
    if (wantPlatforms.length){
      items = items.filter(it =>
        (it.platforms||[]).some(x => wantPlatforms.includes(String(x).toLowerCase()))
      );
    }
    if (wantStatus.length){
      items = items.filter(it => it.status && wantStatus.includes(String(it.status).toLowerCase()));
    }

    // Orden: pinned desc, fecha desc
    items.sort((a,b)=>{
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      const da = a.publishDate ? Date.parse(a.publishDate) : 0;
      const db = b.publishDate ? Date.parse(b.publishDate) : 0;
      return db - da;
    });

    // Limitar a N
    items = items.slice(0, LIM);

    res.status(200).json({ ok:true, items });
  }catch(err){
    console.error(err);
    res.status(200).json({ ok:false, error: String(err?.message || err) });
  }
}
