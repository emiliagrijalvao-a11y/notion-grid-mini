// api/grid.js
const NOTION_VERSION = "2022-06-28";

/* ---------- helpers ---------- */
const getTitle = (p) =>
  p?.Name?.title?.[0]?.plain_text ??
  p?.Title?.title?.[0]?.plain_text ??
  "Untitled";

const getLink = (p) =>
  p?.Link?.url || p?.URL?.url || p?.Url?.url || null;

const getSelect = (p, key) => p?.[key]?.select?.name ?? null;
const getCheckbox = (p, key) => !!p?.[key]?.checkbox;

const getRichText = (p, key) => {
  const arr = p?.[key]?.rich_text || p?.[key]?.title || [];
  return arr.map(t => t?.plain_text ?? "").join("") || "";
};

const fileUrl = (f) => {
  if (!f) return null;
  if (f.type === "file") return f.file?.url || null;
  if (f.type === "external") return f.external?.url || null;
  return null;
};

// Imagen con alias comunes, incluyendo "Image Source" (Files) y URLs
const getImage = (props) => {
  const f =
    props?.Image?.files?.[0] ||
    props?.Attachment?.files?.[0] ||
    props?.Cover?.files?.[0] ||
    props?.["Image Source"]?.files?.[0] ||
    props?.["Image"]?.files?.[0];

  const fromFiles = fileUrl(f);
  if (fromFiles) return fromFiles;

  return (
    props?.["Image URL"]?.url ||
    props?.["Image Source URL"]?.url ||
    props?.["Image Link"]?.url ||
    null
  );
};

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

const isVideoFromUrl = (url) => {
  if (!url) return false;
  const u = url.toLowerCase();
  return u.endsWith(".mp4") || u.endsWith(".webm") || u.endsWith(".mov");
};

/* ---------- Notion fetchers ---------- */
async function queryAll(databaseId, token) {
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
    if (!res.ok) {
      throw new Error(`Notion ${res.status}: ${await res.text()}`);
    }
    const data = await res.json();
    results.push(...(data.results || []));
    has_more = data.has_more;
    next_cursor = data.next_cursor;
  }
  return results;
}

async function getBioFromDatabase(bioDbId, token) {
  if (!bioDbId) return null;

  const pages = await queryAll(bioDbId, token);
  const first = pages[0];
  if (!first) return null;
  const p = first.properties || {};

  // Campos esperados: Avatar (files), Username (text), Display Name (text), Bio (rich text), Link (url)
  const avatarFile =
    p?.Avatar?.files?.[0] ||
    p?.Photo?.files?.[0] ||
    p?.Imagen?.files?.[0];

  const avatar = fileUrl(avatarFile) || null;
  const username = getRichText(p, "Username") || getRichText(p, "User") || "@your_username";
  const name = getRichText(p, "Display Name") || getRichText(p, "Name") || "Grid Content Planner";
  const bioText = getRichText(p, "Bio") || "";
  const textLines = bioText.split("\n").map(s => s.trim()).filter(Boolean);
  const url = getLink(p) || "https://websitelink.com";

  return { username, name, textLines, url, avatar };
}

/* ---------- handler ---------- */
export default async function handler(req, res) {
  try {
    const token = process.env.NOTION_TOKEN;
    const gridDb = process.env.NOTION_DATABASE_ID;
    const bioDb = process.env.BIO_DATABASE_ID;

    if (!token || !gridDb) {
      return res.status(200).json({ ok: false, error: "Missing NOTION envs" });
    }

    // 1) Cargar BIO (prioridad: DB -> ENV)
    const bioFromDb = await getBioFromDatabase(bioDb, token);
    const bio = bioFromDb || {
      username: process.env.BIO_USERNAME || "@your_username",
      name: process.env.BIO_NAME || "Grid Content Planner",
      textLines: (process.env.BIO_TEXT || "")
        .split("\n").map(s => s.trim()).filter(Boolean),
      url: process.env.BIO_URL || "https://websitelink.com",
      avatar: process.env.BIO_AVATAR || "",
    };

    // 2) Cargar GRID
    const pages = await queryAll(gridDb, token);

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
      const isVideo = isVideoFromUrl(image);

      return {
        id: page.id,
        title: getTitle(p),
        platform,
        status,
        pinned,
        image,
        link: getLink(p) || null,
        isVideo,
        _edited: page.last_edited_time || page.created_time,
      };
    }).filter(Boolean);

    // Orden: primero "pinned", luego más reciente
    raw.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return new Date(b._edited) - new Date(a._edited);
    });

    const items = raw.map(({ _edited, ...x }) => x);

    const platforms = Array.from(new Set(items.map(i => i.platform).filter(Boolean)));
    const statuses  = Array.from(new Set(items.map(i => i.status).filter(Boolean)));

    res.status(200).json({
      ok: true,
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
