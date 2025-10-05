// pages/api/grid.js
const NOTION_VERSION = "2022-06-28";

/* ----------------------------- helpers ----------------------------- */
const firstText = (arr = []) => (arr[0]?.plain_text ?? "").trim();

const getTitleFromProps = (p = {}) => {
  // Busca un título en propiedades típicas
  const candidates = [
    p?.Name?.title,
    p?.Title?.title,
  ];
  for (const c of candidates) {
    if (Array.isArray(c) && c.length) {
      const t = firstText(c);
      if (t) return t; // <- SIN "Untitled"
    }
  }
  // También permite Rich Text si alguien lo puso ahí
  const rtCandidates = [
    p?.Name?.rich_text,
    p?.Title?.rich_text,
  ];
  for (const c of rtCandidates) {
    if (Array.isArray(c) && c.length) {
      const t = firstText(c);
      if (t) return t;
    }
  }
  return ""; // vacío si no hay
};

const getUrlFromProps = (p = {}, keys = ["URL", "Url", "Link", "Website", "Web", "Sitio"]) => {
  for (const k of keys) {
    if (p[k]?.type === "url" && p[k]?.url) return p[k].url;
    // A veces lo almacenan como rich_text
    if (p[k]?.rich_text?.length) {
      const t = firstText(p[k].rich_text);
      if (t) return t;
    }
  }
  return null;
};

const getDateFromProps = (p = {}) => {
  const keys = ["Publish Date", "Fecha", "Date"];
  for (const k of keys) {
    const d = p?.[k]?.date?.start;
    if (d) return d;
  }
  return null;
};

const getSelect = (p, keyList) => {
  for (const k of keyList) {
    const v = p?.[k]?.select?.name;
    if (v) return v;
  }
  return null;
};
const getCheckbox = (p, keyList) => {
  for (const k of keyList) {
    const v = p?.[k]?.checkbox;
    if (typeof v === "boolean") return v;
  }
  return false;
};

const isHidden = (props = {}) => {
  // Campos explícitos
  if (getCheckbox(props, ["Hidden", "Hide", "Oculto"])) return true;
  // Cualquier checkbox cuyo nombre contenga hide/hidden/ocult y esté activo
  for (const [name, val] of Object.entries(props)) {
    if (val?.type === "checkbox" && val.checkbox) {
      const n = name.toLowerCase();
      if (/hide|hidden|ocult/.test(n)) return true;
    }
  }
  return false;
};

const fileUrl = (f) => {
  if (!f) return null;
  if (f.type === "file") return f.file?.url || null;
  if (f.type === "external") return f.external?.url || null;
  return null;
};

const getFirstFileUrlFromProps = (p = {}, keys = ["Image", "Attachment", "Cover", "Imagen", "Adjunto"]) => {
  for (const k of keys) {
    const files = p?.[k]?.files;
    if (Array.isArray(files) && files.length) {
      const url = fileUrl(files[0]);
      if (url) return url;
    }
  }
  return null;
};

const isVideoUrl = (url = "") => {
  const u = url.split("?")[0].toLowerCase();
  return /\.(mp4|mov|webm|m4v|avi|mkv)$/.test(u);
};

async function notionQueryAll(databaseId, token, body = {}) {
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
        ...body,
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

async function notionQueryFirst(databaseId, token, body = {}) {
  const url = `https://api.notion.com/v1/databases/${databaseId}/query`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      page_size: 1,
      ...body,
    }),
  });
  if (!res.ok) throw new Error(`Notion ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const item = (data.results || [])[0];
  return item || null;
}

/* ----------------------------- handler ----------------------------- */
export default async function handler(req, res) {
  try {
    const token = process.env.NOTION_TOKEN;
    const db = process.env.NOTION_DATABASE_ID;
    const bioDb = process.env.BIO_SETTINGS_DATABASE_ID; // opcional

    if (!token || !db) {
      return res.status(200).json({ ok: false, error: "Missing NOTION envs" });
    }

    // ---- BIO (desde Notion si hay BIO_SETTINGS_DATABASE_ID; si no, desde envs) ----
    let bio = null;
    if (bioDb) {
      const row = await notionQueryFirst(bioDb, token, {
        sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
      });
      if (row) {
        const p = row.properties || {};
        const username =
          getTitleFromProps({ Name: p?.Username }) ||
          getTitleFromProps({ Name: p?.User }) ||
          (p?.Username?.rich_text?.length ? firstText(p?.Username?.rich_text) : "");
        const name =
          getTitleFromProps(p) || // si la DB tiene columna Name como title
          getTitleFromProps({ Name: p?.["Display Name"] }) ||
          (p?.["Display Name"]?.rich_text?.length ? firstText(p["Display Name"].rich_text) : "");

        let textRaw = "";
        if (p?.Text?.rich_text?.length) textRaw = p.Text.rich_text.map(x => x.plain_text).join("");
        else if (p?.Bio?.rich_text?.length) textRaw = p.Bio.rich_text.map(x => x.plain_text).join("");
        const textLines = textRaw
          ? textRaw.split("\n").map(s => s.trim()).filter(Boolean)
          : [];

        const url =
          getUrlFromProps(p, ["URL", "Website", "Link"]) ||
          null;

        let avatar = null;
        if (p?.Avatar?.files?.length) {
          avatar = fileUrl(p.Avatar.files[0]) || null;
        }

        bio = {
          username: username || "",
          name: name || "",
          textLines,
          url: url || "",
          avatar: avatar || "",
        };
      }
    }

    if (!bio) {
      // Fallback a variables de entorno (si no hay bioDb o está vacío)
      bio = {
        username: process.env.BIO_USERNAME || "",
        name: process.env.BIO_NAME || "",
        textLines: (process.env.BIO_TEXT || "")
          .split("\n").map(s => s.trim()).filter(Boolean),
        url: process.env.BIO_URL || "",
        avatar: process.env.BIO_AVATAR || "",
      };
    }

    // ---- GRID ----
    const pages = await notionQueryAll(db, token, {
      sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
    });

    const raw = pages.map((page) => {
      const p = page.properties || {};
      if (isHidden(p)) return null;

      const title = getTitleFromProps(p); // "" si no hay
      const platform = getSelect(p, ["Platform", "Plataforma", "Plataform"]) || "Other";
      const status = getSelect(p, ["Status", "Estado"]) || null;
      const pinned = getCheckbox(p, ["Pinned", "Pin", "Destacado", "Fijado"]) || false;
      const imageUrl = getFirstFileUrlFromProps(p);
      const link = getUrlFromProps(p) || null;
      const date = getDateFromProps(p); // puede ser null

      const isVideo = imageUrl ? isVideoUrl(imageUrl) : false;

      return {
        id: page.id,
        title,
        platform,
        status,
        pinned,
        image: imageUrl,
        isVideo,
        link,
        date,
        _edited: page.last_edited_time || page.created_time,
      };
    }).filter(Boolean);

    // Orden base: pinned primero, luego por última edición (desc)
    raw.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return new Date(b._edited) - new Date(a._edited);
    });

    const items = raw.map(({ _edited, ...x }) => x);

    const platforms = Array.from(new Set(items.map(i => i.platform).filter(Boolean)));
    const statuses  = Array.from(new Set(items.map(i => i.status).filter(Boolean)));

    return res.status(200).json({
      ok: true,
      dbId: db, // para key de order localStorage
      bio,
      filters: {
        platforms: platforms.length ? platforms : ["Instagram", "Tik Tok", "Other"],
        status: statuses.length ? statuses : ["Idea", "Draft", "In progress", "Done"],
      },
      items,
    });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e.message || e) });
  }
}
