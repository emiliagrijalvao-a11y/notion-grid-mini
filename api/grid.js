// /api/grid.js
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const NOTION_VERSION = "2022-06-28";

// --- utils ---
const isVideoUrl = (u = "") => /\.(mp4|webm|mov|m4v)(\?|$)/i.test(u);
const getText = (arr = []) => arr.map(t => t.plain_text || "").join("").trim();
const findKey = (props = {}, candidates = []) => {
  const keys = Object.keys(props);
  const low = key => key.trim().toLowerCase();
  return keys.find(k => candidates.some(c => low(k) === c.toLowerCase())) || null;
};

async function queryAll(databaseId) {
  let results = [];
  let cursor = undefined;
  do {
    const r = await fetch("https://api.notion.com/v1/databases/" + databaseId + "/query", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${NOTION_TOKEN}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ page_size: 100, start_cursor: cursor }),
    });
    if (!r.ok) throw new Error(`Notion query failed: ${r.status}`);
    const json = await r.json();
    results = results.concat(json.results || []);
    cursor = json.has_more ? json.next_cursor : undefined;
  } while (cursor);
  return results;
}

function pickFromPage(page) {
  const p = page.properties || {};

  const titleK  = findKey(p, ["Name","Title"]);
  const dateK   = findKey(p, ["Publish Date","Date","Fecha"]);
  const platK   = findKey(p, ["Platform","Platforms","Plataforma"]);
  const statusK = findKey(p, ["Status","Estado"]);
  const capK    = findKey(p, ["Caption","Descripción","Description","Text"]);
  const attachK = findKey(p, ["Attachment","Image","Files","Image Files"]);
  const linkK   = findKey(p, ["Link","URL","Image URL"]);
  const srcK    = findKey(p, ["Image Source","Source"]);
  const pinK    = findKey(p, ["Pinned","Pin","Destacado"]);
  const hideK   = findKey(p, ["Hide","Hidden","Ocultar","Archive","Archived"]);

  const title     = titleK  ? getText(p[titleK].title) : "";
  const caption   = capK    ? getText(p[capK].rich_text) : "";
  const publishDt = dateK   ? (p[dateK].date?.start || null) : null;
  const status    = statusK ? (p[statusK].select?.name || null) : null;

  let platforms = [];
  if (platK) {
    if (p[platK].multi_select?.length) platforms = p[platK].multi_select.map(x => x.name);
    else if (p[platK].select?.name) platforms = [p[platK].select.name];
  }

  const pinned = pinK ? !!p[pinK].checkbox : false;
  const hidden = hideK ? !!p[hideK].checkbox : false;

  const imgSrcPref = srcK ? (p[srcK].select?.name || "").toLowerCase() : "";
  const files = attachK ? (p[attachK].files || []) : [];
  const fileUrl = files[0]?.file?.url || files[0]?.external?.url || "";
  const linkUrl = linkK ? (p[linkK].url || "") : "";
  const cover = page.cover?.file?.url || page.cover?.external?.url || "";

  let mediaUrl = "";
  let kind = "image";
  const decide = url => { kind = isVideoUrl(url) ? "video" : "image"; return url; };

  if (imgSrcPref === "link" && linkUrl)       mediaUrl = decide(linkUrl);
  else if (imgSrcPref.startsWith("image") && fileUrl) mediaUrl = decide(fileUrl);
  else if (fileUrl)                            mediaUrl = decide(fileUrl);
  else if (linkUrl)                            mediaUrl = decide(linkUrl);
  else if (cover)                              mediaUrl = decide(cover);

  return {
    id: page.id,
    title,
    caption,
    publishDate: publishDt,
    status,
    platforms,
    pinned,
    hidden,
    media: mediaUrl ? { kind, url: mediaUrl } : null,
  };
}

module.exports = async (req, res) => {
  try {
    if (!NOTION_TOKEN || !NOTION_DATABASE_ID) {
      res.status(500).json({ ok: false, error: "Missing NOTION_TOKEN or NOTION_DATABASE_ID" });
      return;
    }

    const all = await queryAll(NOTION_DATABASE_ID);
    let items = all.map(pickFromPage);

    // Ocultar "Hide"
    items = items.filter(it => !it.hidden && it.media);

    // Filtros (case-insensitive)
    const { platform = "", status = "", limit = "12" } = req.query || {};
    const wantP = platform ? platform.split(",").map(s => s.trim().toLowerCase()).filter(Boolean) : [];
    const wantS = status ? status.split(",").map(s => s.trim().toLowerCase()).filter(Boolean) : [];

    if (wantP.length) {
      items = items.filter(it => (it.platforms || []).some(p => wantP.includes(String(p).toLowerCase())));
    }
    if (wantS.length) {
      items = items.filter(it => it.status && wantS.includes(String(it.status).toLowerCase()));
    }

    // Orden: pinned desc, fecha desc
    items.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      const da = a.publishDate ? Date.parse(a.publishDate) : 0;
      const db = b.publishDate ? Date.parse(b.publishDate) : 0;
      return db - da;
    });

    // Límite
    const LIM = Math.max(1, Math.min(60, parseInt(limit, 10) || 12));
    items = items.slice(0, LIM);

    res.status(200).json({ ok: true, items });
  } catch (err) {
    res.status(200).json({ ok: false, error: String(err?.message || err) });
  }
};
