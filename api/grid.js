// /api/grid.js
// Vercel/Next API route – Notion → JSON para el widget
const NOTION_VERSION = "2022-06-28";

/* ----------------------- helpers: lectura de propiedades ----------------------- */
const txt = (arr) => (Array.isArray(arr) ? arr.map(t => t?.plain_text ?? "").join("") : "");
const titleOf = (p) =>
  txt(p?.Name?.title) ||
  txt(p?.Title?.title) ||
  txt(p?.["Display Name"]?.title) ||
  "Untitled";

const rich = (p, key) => txt(p?.[key]?.rich_text);

const urlOf = (p, key) => p?.[key]?.url || null;
const selectOf = (p, key) => p?.[key]?.select?.name ?? null;
const checkOf  = (p, key) => !!p?.[key]?.checkbox;

const fileUrl = (f) => {
  if (!f) return null;
  if (f.type === "file")     return f.file?.url || null;
  if (f.type === "external") return f.external?.url || null;
  return null;
};
const firstFileFrom = (prop) => fileUrl(prop?.files?.[0] || null);

const looksLikeVideo = (u) =>
  typeof u === "string" && /\.(mp4|mov|webm|m4v)(\?.*)?$/i.test(u);

const getImage = (p) =>
  // Archivos
  firstFileFrom(p?.Attachment) ||
  firstFileFrom(p?.Image)      ||
  firstFileFrom(p?.Cover)      ||
  // URLs de imagen
  urlOf(p, "Image URL") || urlOf(p, "Image Url") || urlOf(p, "Image") || null;

const getDate = (p, page) =>
  p?.["Publish Date"]?.date?.start ||
  p?.["Publish date"]?.date?.start ||
  p?.Date?.date?.start ||
  page?.last_edited_time ||
  page?.created_time ||
  null;

const isHidden = (props = {}) => {
  if (checkOf(props, "Hidden")) return true;
  if (checkOf(props, "Hide"))   return true;
  if (checkOf(props, "Oculto")) return true;

  for (const [name, val] of Object.entries(props)) {
    if (val?.type === "checkbox") {
      const n = name.toLowerCase();
      if ((/hide|hidden|ocult/).test(n) && val.checkbox) return true;
    }
  }
  return false;
};

/* ----------------------- Notion: query paginado ----------------------- */
async function queryAll(databaseId, token) {
  const url = `https://api.notion.com/v1/databases/${databaseId}/query`;
  let has_more = true, next_cursor = undefined, results = [];

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
      const msg = await res.text();
      throw new Error(`Notion ${res.status}: ${msg}`);
    }

    const data = await res.json();
    results.push(...(data.results || []));
    has_more   = data.has_more;
    next_cursor = data.next_cursor;
  }
  return results;
}

/* ----------------------- Bio: leer desde base "Bio Settings" ----------------------- */
async function fetchBio(token, bioDbId) {
  if (!bioDbId) return null;

  const pages = await queryAll(bioDbId, token);
  if (!pages.length) return null;

  // Tomamos la fila más recientemente editada
  const page = pages[0];
  const p = page.properties || {};

  const avatar =
    firstFileFrom(p?.Avatar) || // Attachments (lo que estás usando)
    urlOf(p, "Avatar")        || // por si algún día usan URL
    "";

  const username =
    rich(p, "Username") ||
    titleOf(p) ||
    "";

  const name =
    rich(p, "Display Name") ||
    titleOf(p) ||
    "";

  const bioText =
    rich(p, "Bio") || "";

  const url = urlOf(p, "Link") || "";

  return {
    username,
    name,
    textLines: bioText
      .split("\n")
      .map(s => s.trim())
      .filter(Boolean),
    url,
    avatar,
  };
}

/* ----------------------- Handler ----------------------- */
export default async function handler(req, res) {
  try {
    const token = process.env.NOTION_TOKEN;
    const gridDb = process.env.NOTION_DATABASE_ID;
    const bioDb  = process.env.BIO_DATABASE_ID; // <- tu tabla "Bio Settings"

    if (!token || !gridDb) {
      return res.status(200).json({ ok: false, error: "Missing NOTION envs" });
    }

    // 1) Grid
    const pages = await queryAll(gridDb, token);

    const raw = pages.map((page) => {
      const p = page.properties || {};
      if (isHidden(p)) return null;

      const image = getImage(p);

      const platform =
        selectOf(p, "Platform") ||
        selectOf(p, "Plataform") ||
        selectOf(p, "Plataforma") ||
        "Other";

      const status =
        selectOf(p, "Status") ||
        selectOf(p, "Estado") ||
        null;

      const pinned =
        checkOf(p, "Pinned") || checkOf(p, "Pin") || false;

      // Caption/description opcional para el modal
      const caption =
        rich(p, "Caption") ||
        rich(p, "Description") ||
        rich(p, "Notes") ||
        "";

      const link = getLink(p) || null;

      const date = getDate(p, page);

      const isVideo =
        checkOf(p, "Video") ||
        selectOf(p, "Type") === "Video" ||
        looksLikeVideo(image);

      return {
        id: page.id,
        title: titleOf(p),
        caption,
        platform,
        status,
        pinned,
        image,
        link,
        date,
        isVideo,
        _edited: page.last_edited_time || page.created_time,
      };
    }).filter(Boolean);

    // Orden: primero pineados, luego último editado
    raw.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return new Date(b._edited) - new Date(a._edited);
    });

    const items = raw.map(({ _edited, ...x }) => x);

    // Filtros dinámicos
    const platforms = Array.from(new Set(items.map(i => i.platform).filter(Boolean)));
    const statuses  = Array.from(new Set(items.map(i => i.status).filter(Boolean)));

    // 2) Bio
    const bio = await fetchBio(token, bioDb);

    res.status(200).json({
      ok: true,
      bio, // <- el front lo usa tal cual
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
