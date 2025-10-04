// api/grid.js
const NOTION_VERSION = "2022-06-28";

// ---------- Utils ----------
const rt = a => (Array.isArray(a) ? a.map(x => x?.plain_text ?? "").join("") : "");
const titleOf = p =>
  p?.Name?.title?.[0]?.plain_text ??
  p?.Title?.title?.[0]?.plain_text ??
  "Untitled";

const fileUrl = f => {
  if (!f) return null;
  if (f.type === "file") return f.file?.url || null;
  if (f.type === "external") return f.external?.url || null;
  return null;
};

const firstFileFrom = filesProp =>
  fileUrl(filesProp?.files?.[0]) || null;

const getImageFromProps = p =>
  firstFileFrom(p?.["Image Source"]) ||
  firstFileFrom(p?.Image) ||
  firstFileFrom(p?.Attachment) ||
  firstFileFrom(p?.Cover) ||
  null;

const getLink = p =>
  p?.Link?.url || p?.URL?.url || p?.Url?.url || null;

const getSelect = (p, key) => p?.[key]?.select?.name ?? null;
const getCheckbox = (p, key) => !!p?.[key]?.checkbox;

// Oculta SOLO si el nombre es exactamente Hidden / Hide / Oculto
const isHidden = (props = {}) =>
  !!(props?.Hidden?.checkbox || props?.Hide?.checkbox || props?.Oculto?.checkbox);

const getDate = p =>
  p?.["Publish Date"]?.date?.start ||
  p?.["Publish date"]?.date?.start ||
  p?.["Publish"]?.date?.start ||
  p?.["Date"]?.date?.start ||
  p?.["Fecha"]?.date?.start ||
  null;

async function notionQueryAll(databaseId, token, sorts = [{ timestamp: "last_edited_time", direction: "descending" }]) {
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
      body: JSON.stringify({ page_size: 100, start_cursor: next_cursor, sorts }),
    });
    if (!res.ok) throw new Error(`Notion ${res.status}: ${await res.text()}`);
    const data = await res.json();
    results.push(...(data.results || []));
    has_more = data.has_more;
    next_cursor = data.next_cursor;
  }
  return results;
}

// ---------- Bio desde DB (opcional) ----------
async function readBioFromDb(bioDbId, token) {
  const pages = await notionQueryAll(bioDbId, token);
  const page = pages[0];                     // la fila más reciente
  if (!page) return null;

  const p = page.properties || {};
  const username =
    rt(p?.Username?.title) ||
    rt(p?.Username?.rich_text) ||
    rt(p?.["User"]?.title) ||
    "";
  const name =
    rt(p?.["Display Name"]?.rich_text) ||
    rt(p?.["Display Name"]?.title) ||
    rt(p?.Name?.title) ||
    "";
  const bioText = rt(p?.Bio?.rich_text || []);
  const link = p?.Link?.url || "";

  // Avatar como attachments
  const avatar =
    firstFileFrom(p?.Avatar) || null;

  return {
    username: username || "",
    name: name || "",
    textLines: (bioText || "").split("\n").map(s => s.trim()).filter(Boolean),
    url: link || "",
    avatar: avatar || ""
  };
}

// ---------- Handler ----------
export default async function handler(req, res) {
  try {
    const token = process.env.NOTION_TOKEN;
    const gridDb = process.env.NOTION_DATABASE_ID;
    const bioDb = process.env.BIO_DATABASE_ID || null;

    if (!token || !gridDb) {
      return res.status(200).json({ ok: false, error: "Missing NOTION envs" });
    }

    // Bio: DB > ENV fallback
    let bio = null;
    if (bioDb) {
      try {
        bio = await readBioFromDb(bioDb, token);
      } catch (e) {
        // Si falla, seguimos con fallback ENV
      }
    }
    if (!bio) {
      bio = {
        username: process.env.BIO_USERNAME || "",
        name: process.env.BIO_NAME || "",
        textLines: (process.env.BIO_TEXT || "").split("\n").map(s => s.trim()).filter(Boolean),
        url: process.env.BIO_URL || "",
        avatar: process.env.BIO_AVATAR || ""
      };
    }

    // Grid
    const pages = await notionQueryAll(gridDb, token);
    const mapped = pages.map(page => {
      const p = page.properties || {};
      if (isHidden(p)) return null;

      const platform =
        getSelect(p, "Platform") || getSelect(p, "Plataforma") || getSelect(p, "Plataform") || "Other";
      const status =
        getSelect(p, "Status") || getSelect(p, "Estado") || null;

      const image = getImageFromProps(p) || (page.cover ? fileUrl(page.cover) : null);

      return {
        id: page.id,
        title: titleOf(p),
        platform,
        status,
        pinned: getCheckbox(p, "Pinned") || getCheckbox(p, "Pin") || false,
        image,
        link: getLink(p) || null,
        date: getDate(p) || page.last_edited_time || null,
        _sort: page.last_edited_time
      };
    }).filter(Boolean);

    // Ordenar: Pinned primero, luego más reciente
    mapped.sort((a, b) => (b.pinned - a.pinned) || (new Date(b._sort) - new Date(a._sort)));
    const items = mapped.map(({ _sort, ...x }) => x);

    const platforms = Array.from(new Set(items.map(i => i.platform).filter(Boolean)));
    const statuses = Array.from(new Set(items.map(i => i.status).filter(Boolean)));

    res.status(200).json({
      ok: true,
      bio,
      filters: {
        platforms: platforms.length ? platforms : ["Instagram", "Tik Tok", "Other"],
        status: statuses.length ? statuses : ["Idea", "Draft", "In progress", "Done"],
      },
      items
    });
  } catch (e) {
    res.status(200).json({ ok: false, error: String(e.message || e) });
  }
}
