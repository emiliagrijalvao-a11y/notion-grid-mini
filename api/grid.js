// /api/grid.js
const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

/* ----------------------------- helpers ----------------------------- */
const firstText = (arr = []) => (arr[0]?.plain_text ?? "").trim();
const rtText = (p) => {
  if (!p) return "";
  const arr = p.rich_text || p.title || [];
  return arr.map(x => x.plain_text || "").join("").trim();
};
const sel = (p) => (p?.select?.name) || (p?.status?.name) || "";
const checkbox = (p) => !!(p && p.checkbox);
const dateStr = (p) => p?.date?.start || "";

const fileUrl = (f) => {
  if (!f) return null;
  if (f.type === "file") return f.file?.url || null;
  if (f.type === "external") return f.external?.url || null;
  return null;
};
const filesToAssetsFromProperty = (prop) => {
  const files = prop?.files || [];
  return files.map(f => {
    const url = f.external?.url || f.file?.url || "";
    const name = (f.name || url || "").toLowerCase();
    const isVideo = /\.(mp4|webm|mov|m4v)$/i.test(name);
    return url ? { type: isVideo ? "video" : "image", url } : null;
  }).filter(Boolean);
};
const freqSort = (arr) => {
  const count = {};
  arr.forEach(x => { if(x) count[x] = (count[x] || 0) + 1; });
  return [...new Set(arr.filter(Boolean))].sort((a, b) => (count[b] || 0) - (count[a] || 0));
};

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

/* ----------------------------- handler ----------------------------- */
export default async function handler(req, res) {
  try {
    const dbId = process.env.NOTION_DATABASE_ID;
    if (!process.env.NOTION_TOKEN || !dbId) {
      return res.status(200).json({ ok: false, error: "Missing NOTION_TOKEN or NOTION_DATABASE_ID" });
    }

    // 1) GRID
    const q = await notionFetch(`/databases/${dbId}/query`, {
      sorts: [{ property: "Publish Date", direction: "descending" }],
      page_size: 100,
    });

    const items = [];
    for (const r of q.results || []) {
      const p = r.properties || {};
      const id = r.id;

      // Assets desde Attachments/Attachment/Media (cualquiera de esas)
      let assets = [];
      assets = assets.concat(filesToAssetsFromProperty(p["Attachments"]));
      assets = assets.concat(filesToAssetsFromProperty(p["Attachment"]));
      assets = assets.concat(filesToAssetsFromProperty(p["Media"]));
      // miniatura (compatibilidad con front antiguo)
      const thumb = assets[0]?.url || null;

      const title = rtText(p["Title"]) || ""; // sin "Untitled"
      const caption = rtText(p["Caption"]) || "";
      const platform = sel(p["Platform"]) || "Other";
      const status = sel(p["Status"]) || null;
      const pinned = checkbox(p["Pinned"]);
      const date = dateStr(p["Publish Date"]) || null;

      items.push({
        id, title, caption, platform, status, pinned, date,
        assets,
        isVideo: assets.some(a => a.type === "video"),
        image: thumb, // compat
      });
    }

    // 2) BIO (opcional)
    let bio = null;
    const bioDb = process.env.BIO_DATABASE_ID;
    if (bioDb) {
      const qb = await notionFetch(`/databases/${bioDb}/query`, { page_size: 1, sorts: [{ timestamp: "last_edited_time", direction: "descending" }] });
      const row = (qb.results || [])[0];
      if (row) {
        const bp = row.properties || {};
        const avatarFiles = filesToAssetsFromProperty(bp["Avatar"]);
        const linesRaw = rtText(bp["Lines"]) || rtText(bp["Bio"]) || "";
        bio = {
          username: rtText(bp["Username"]) || rtText(bp["Handle"]) || "",
          name: rtText(bp["Name"]) || "",
          textLines: linesRaw ? linesRaw.split("\n").map(s=>s.trim()).filter(Boolean) : [],
          url: bp?.URL?.url || "",
          avatar: avatarFiles[0]?.url || "",
        };
      }
    }
    if (!bio) {
      bio = {
        username: process.env.BIO_USERNAME || "",
        name: process.env.BIO_NAME || "",
        textLines: (process.env.BIO_TEXT || "").split("\n").map(s=>s.trim()).filter(Boolean),
        url: process.env.BIO_URL || "",
        avatar: process.env.BIO_AVATAR || "",
      };
    }

    // 3) Filtros dinámicos (IG arriba)
    const platforms = freqSort(items.map(i => i.platform));
    const statuses  = freqSort(items.map(i => i.status));
    const igIndex = platforms.findIndex(x => (x||"").toLowerCase() === "instagram");
    if (igIndex > 0) platforms.splice(0, 0, platforms.splice(igIndex, 1)[0]); // sube IG

    return res.status(200).json({
      ok: true,
      dbId,
      filters: { platforms, status: statuses },
      items,
      bio,
    });
  } catch (err) {
    res.status(200).json({ ok: false, error: String(err.message || err) });
  }
}
