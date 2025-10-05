// api/grid.js
const NOTION_VERSION = "2022-06-28";

const isVideoUrl = (u = "") =>
  /\.(mp4|mov|m4v|webm)$/i.test(u.split("?")[0] || "");

const fileUrl = (f) => {
  if (!f) return null;
  if (f.type === "file") return f.file?.url || null;
  if (f.type === "external") return f.external?.url || null;
  return null;
};

const getTitle = (p) =>
  p?.Name?.title?.[0]?.plain_text ??
  p?.Title?.title?.[0]?.plain_text ??
  "Untitled";

const getCaption = (p) =>
  (p?.Caption?.rich_text || p?.Description?.rich_text || [])
    .map((t) => t.plain_text)
    .join(" ")
    .trim();

const getLink = (p) =>
  p?.Link?.url || p?.URL?.url || p?.Url?.url || null;

const getSelect = (p, key) => p?.[key]?.select?.name ?? null;
const getCheckbox = (p, key) => !!p?.[key]?.checkbox;

const getDate = (p) =>
  p?.Date?.date?.start ||
  p?.Fecha?.date?.start ||
  p?.Published?.date?.start ||
  null;

const getImage = (p) =>
  fileUrl(
    p?.Image?.files?.[0] ||
    p?.Attachment?.files?.[0] ||
    p?.Cover?.files?.[0]
  );

const isHidden = (props = {}) => {
  if (getCheckbox(props, "Hidden")) return true;
  if (getCheckbox(props, "Hide")) return true;
  if (getCheckbox(props, "Oculto")) return true;
  for (const [name, val] of Object.entries(props)) {
    if (val?.type === "checkbox") {
      const n = name.toLowerCase();
      if ((/hide|hidden|ocult/).test(n) && val.checkbox) return true;
    }
  }
  return false;
};

async function notionQueryAll(databaseId, token) {
  const url = `https://api.notion.com/v1/databases/${databaseId}/query`;
  let has_more = true, next_cursor, results = [];
  while (has_more) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        page_size: 100,
        start_cursor: next_cursor,
        sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
      }),
    });
    if (!res.ok) throw new Error(`Notion ${res.status}: ${await res.text()}`);
    const data = await res.json();
    results.push(...(data.results || []));
    has_more = data.has_more;
    next_cursor = data.next_cursor;
  }
  return results;
}

async function getBioFromDb(bioDbId, token) {
  if (!bioDbId) return null;
  const rows = await notionQueryAll(bioDbId, token);
  if (!rows.length) return null;

  // Tomamos la fila más reciente
  const page = rows[0];
  const p = page.properties || {};

  // Campos esperados en Notion (Bio Settings):
  // Name (title)   → display name/categoría
  // Username (text)
  // Lines   (text, multiline)  → 1 línea por \n
  // URL     (url)
  // Avatar  (files) → 1er archivo como avatar
  const avatar = fileUrl(p?.Avatar?.files?.[0]);
  const username =
    (p?.Username?.rich_text || [])
      .map((t) => t.plain_text)
      .join("")
      .trim() || null;

  const lines =
    (p?.Lines?.rich_text || [])
      .map((t) => t.plain_text)
      .join("\n")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

  return {
    username: username || "@your_username",
    name: getTitle(p) || "Grid Content Planner",
    textLines: lines || [],
    url: p?.URL?.url || process.env.BIO_FALLBACK_URL || "https://websitelink.com",
    avatar: avatar || "",
  };
}

export default async function handler(req, res) {
  try {
    const token = process.env.NOTION_TOKEN;
    const db = process.env.NOTION_DATABASE_ID;
    const bioDb = process.env.BIO_DATABASE_ID;

    if (!token || !db) {
      return res.status(200).json({ ok: false, error: "Missing NOTION envs" });
    }

    // BIO: primero intento Notion (Bio Settings). Si no hay, uso fallback de envs (si existieran)
    const bioFromDb = await getBioFromDb(bioDb, token);
    const bio = bioFromDb || {
      username: process.env.BIO_USERNAME || "@your_username",
      name: process.env.BIO_NAME || "Grid Content Planner",
      textLines: (process.env.BIO_TEXT || "")
        .split("\n").map(s => s.trim()).filter(Boolean),
      url: process.env.BIO_URL || process.env.BIO_FALLBACK_URL || "https://websitelink.com",
      avatar: process.env.BIO_AVATAR || "",
    };

    // GRID
    const pages = await notionQueryAll(db, token);

    const raw = pages.map((page) => {
      const p = page.properties || {};
      if (isHidden(p)) return null;

      const pinned =
        getCheckbox(p, "Pinned") || getCheckbox(p, "Pin") || false;

      const platform =
        getSelect(p, "Platform") ||
        getSelect(p, "Plataform") ||
        getSelect(p, "Plataforma") ||
        "Other";

      const status =
        getSelect(p, "Status") ||
        getSelect(p, "Estado") ||
        null;

      const image = getImage(p);
      const link = getLink(p) || null;

      // Detectar video:
      // 1) Checkbox "Video" o "Is Video"
      // 2) Select "Type" = Video
      // 3) URL con extensión de video
      const isVideo =
        getCheckbox(p, "Video") ||
        getCheckbox(p, "Is Video") ||
        (getSelect(p, "Type") || "").toLowerCase() === "video" ||
        isVideoUrl(image || "");

      const date = getDate(p);
      const caption = getCaption(p);

      return {
        id: page.id,
        title: getTitle(p),
        caption,
        date,
        platform,
        status,
        pinned,
        isVideo,
        image,
        link,
        _edited: page.last_edited_time || page.created_time,
      };
    }).filter(Boolean);

    // Orden base: pinned primero, luego por fecha desc (o last_edited)
    raw.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      const da = a.date ? new Date(a.date) : new Date(a._edited);
      const dbb = b.date ? new Date(b.date) : new Date(b._edited);
      return dbb - da; // desc
    });

    // Distintos para filtros
    const items = raw.map(({ _edited, ...x }) => x);
    const platforms = Array.from(new Set(items.map(i => i.platform).filter(Boolean)));
    const statuses  = Array.from(new Set(items.map(i => i.status).filter(Boolean)));

    res.status(200).json({
      ok: true,
      dbId: db,           // <- para guardar orden local por DB
      bio,
      filters: {
        platforms: platforms.length ? platforms : ["Instagram", "Tik Tok", "Other"],
        status: statuses.length ? statuses : ["Idea", "Draft", "In progress", "Done"],
      },
      items,
    });
  } catch (e) {
    res.status(200).json({ ok: false, error: String(e.message || e) });
  }
}
