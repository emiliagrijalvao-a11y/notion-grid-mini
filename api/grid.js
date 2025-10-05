// /api/grid.js
const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

async function notionFetch(path, body) {
  const r = await fetch(`${NOTION_API}${path}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Notion ${r.status}: ${t}`);
  }
  return r.json();
}

function rtText(p) {
  if (!p) return "";
  const arr = p.rich_text || p.title || [];
  return arr.map(x => x.plain_text || "").join("").trim();
}
function sel(p) {
  if (!p) return "";
  if (p.select && p.select.name) return p.select.name;
  if (p.status && p.status.name) return p.status.name;
  return "";
}
function checkbox(p) {
  return !!(p && p.checkbox);
}
function dateStr(p) {
  const v = p?.date?.start || "";
  return v || "";
}
function urlProp(p) {
  return p?.url || "";
}
function filesToAssets(p) {
  const files = p?.files || [];
  return files.map(f => {
    const url = f.external?.url || f.file?.url || "";
    const name = f.name || "";
    const lower = (name || url).toLowerCase();
    const isVideo = /\.(mp4|webm|mov|m4v)$/.test(lower);
    const type = isVideo ? "video" : "image";
    return { type, url };
  }).filter(a => a.url);
}

function freqSort(arr) {
  const count = {};
  arr.forEach(x => { count[x] = (count[x] || 0) + 1; });
  return [...new Set(arr)].sort((a, b) => (count[b] || 0) - (count[a] || 0));
}

export default async function handler(req, res) {
  try {
    const dbId = process.env.NOTION_DATABASE_ID;
    if (!process.env.NOTION_TOKEN || !dbId) {
      return res.status(200).json({
        ok: false,
        error: "Missing NOTION_TOKEN or NOTION_DATABASE_ID",
      });
    }

    // 1) GRID PAGES
    const q = await notionFetch(`/databases/${dbId}/query`, {
      sorts: [{ property: "Publish Date", direction: "descending" }],
      page_size: 100,
    });

    const items = [];
    const platforms = [];
    const statuses = [];

    for (const r of q.results || []) {
      const p = r.properties || {};
      const id = r.id;

      const title = rtText(p["Title"]);
      const caption = rtText(p["Caption"]);
      const platform = sel(p["Platform"]);
      const status = sel(p["Status"]);
      const pinned = checkbox(p["Pinned"]);
      const date = dateStr(p["Publish Date"]);

      // Soportar image/video (Files, Attachments, Media…)
      const assets =
        filesToAssets(p["Attachments"]) ||
        filesToAssets(p["Attachment"]) ||
        filesToAssets(p["Media"]) ||
        [];

      // primera miniatura
      const thumb = assets[0]?.url || "";

      if (platform) platforms.push(platform);
      if (status) statuses.push(status);

      items.push({
        id,
        title,
        caption,
        platform,
        status,
        pinned,
        date,
        assets,              // [{type:'image'|'video', url}]
        isVideo: assets.some(a => a.type === "video"),
        image: thumb,        // compat con frontend
      });
    }

    // 2) BIO (opcional)
    let bio = null;
    const bioDb = process.env.BIO_DATABASE_ID;
    if (bioDb) {
      const qb = await notionFetch(`/databases/${bioDb}/query`, { page_size: 1 });
      const row = (qb.results || [])[0];
      if (row) {
        const bp = row.properties || {};
        const avatarFiles = filesToAssets(bp["Avatar"]);
        const linesRaw = rtText(bp["Lines"]) || rtText(bp["Bio"]) || "";
        bio = {
          username: rtText(bp["Username"]) || rtText(bp["Handle"]) || "",
          name: rtText(bp["Name"]) || "",
          textLines: linesRaw ? linesRaw.split("\n") : [],
          url: urlProp(bp["URL"]) || urlProp(bp["Link"]) || "",
          avatar: avatarFiles[0]?.url || "",
        };
      }
    }

    // 3) filtros dinámicos + reglas: IG primero, resto por frecuencia
    const P = freqSort(platforms);
    const S = freqSort(statuses);
    const igIndex = P.findIndex(x => x.toLowerCase() === "instagram");
    if (igIndex > 0) { P.splice(0, 0, P.splice(igIndex, 1)[0]); } // subir IG al top

    res.status(200).json({
      ok: true,
      dbId,
      items,
      filters: {
        platforms: P,
        status: S,
      },
      bio,
    });
  } catch (err) {
    res.status(200).json({ ok: false, error: String(err.message || err) });
  }
}
