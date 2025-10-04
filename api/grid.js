// /api/grid.js
// Devuelve los ítems de tu base de Notion listos para el grid.
// Requiere env: NOTION_TOKEN, NOTION_DATABASE_ID

const NOTION_VERSION = "2022-06-28";

function pickTitle(props = {}) {
  const name =
    props?.Name?.title?.[0]?.plain_text ??
    props?.Title?.rich_text?.[0]?.plain_text ??
    props?.["Post Title"]?.title?.[0]?.plain_text ??
    props?.["Title"]?.title?.[0]?.plain_text ??
    "";
  const caption =
    props?.Caption?.rich_text?.[0]?.plain_text ??
    props?.["Title Rt"]?.rich_text?.[0]?.plain_text ??
    "";
  return name || caption || "Sin título";
}

function pickLink(props = {}) {
  return (
    props?.Link?.url ??
    props?.URL?.url ??
    props?.["Post URL"]?.url ??
    null
  );
}

function fileUrl(f) {
  if (!f) return null;
  if (f.type === "file") return f.file?.url || null;
  return f.external?.url || null;
}

function pickImage(page = {}) {
  const props = page?.properties || {};
  // Prioridad: Image / Cover / Attachment
  const f =
    props?.Image?.files?.[0] ??
    props?.Cover?.files?.[0] ??
    props?.Attachment?.files?.[0] ??
    null;

  if (f) {
    return fileUrl(f);
  }

  // Propiedad URL directa
  if (props?.["Image Source"]?.url) return props["Image Source"].url;

  // Cover del page
  const cover = page?.cover;
  if (cover) {
    return cover.type === "file" ? cover.file?.url : cover.external?.url;
  }
  return null;
}

function pickPlatforms(props = {}, link) {
  // multi_select o select
  const ms = props?.Platform?.multi_select || props?.Platforms?.multi_select;
  if (Array.isArray(ms) && ms.length) return ms.map((x) => x?.name).filter(Boolean);

  const sel = props?.Platform?.select || props?.Status?.select;
  if (sel?.name) return [sel.name];

  // Inferencia por URL
  if (link?.includes("instagram.com")) return ["Instagram"];
  if (link?.includes("tiktok.com")) return ["Tik Tok"];
  return ["Other"];
}

function pickStatus(props = {}) {
  return (
    props?.Status?.status?.name ??
    props?.Status?.select?.name ??
    null
  );
}

function isVideoFromUrl(url) {
  if (!url) return false;
  const u = url.toLowerCase();
  return u.endsWith(".mp4") || u.endsWith(".mov") || u.includes("youtu");
}

function isHidden(page) {
  const p = page?.properties || {};
  return !!(
    p?.Hidden?.checkbox ||
    p?.Hide?.checkbox ||
    p?.["Hide from Grid"]?.checkbox ||
    p?.["Oculto"]?.checkbox ||
    (p?.Status?.status?.name === "Hidden")
  );
}

function isPinned(page) {
  const p = page?.properties || {};
  return !!(
    p?.Pinned?.checkbox ||
    p?.Pin?.checkbox ||
    p?.Star?.checkbox ||
    p?.Featured?.checkbox ||
    (p?.Status?.status?.name === "Pinned")
  );
}

async function notionQueryAll(token, databaseId, body) {
  const url = `https://api.notion.com/v1/databases/${databaseId}/query`;
  const headers = {
    "Authorization": `Bearer ${token}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };

  let results = [];
  let start_cursor = undefined;
  do {
    const r = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...body, start_cursor }),
    });
    if (!r.ok) {
      const t = await r.text();
      throw new Error(`Notion query failed: ${r.status} ${t}`);
    }
    const data = await r.json();
    results = results.concat(data.results || []);
    start_cursor = data.has_more ? data.next_cursor : undefined;
  } while (start_cursor && results.length < 200);

  return results;
}

export default async function handler(req, res) {
  try {
    const token = process.env.NOTION_TOKEN;
    const databaseId = process.env.NOTION_DATABASE_ID;
    if (!token || !databaseId) {
      return res.status(200).json({ ok: false, items: [], error: "Missing NOTION env" });
    }

    // Ordenar por fecha si hay una propiedad; si no, por última edición
    const sorts = [
      { property: "Publish Date", direction: "descending" },
      { timestamp: "last_edited_time", direction: "descending" },
    ];

    const results = await notionQueryAll(token, databaseId, {
      page_size: 60,
      sorts,
    });

    const items = results
      .filter((p) => !isHidden(p))
      .map((page) => {
        const props = page?.properties || {};
        const link = pickLink(props);
        const image = pickImage(page);
        const platforms = pickPlatforms(props, link);

        return {
          id: page.id,
          title: pickTitle(props),
          link,
          image,
          platform: platforms[0] || "Other",
          platforms,
          status: pickStatus(props),
          pinned: isPinned(page),
          isVideo: isVideoFromUrl(image) || isVideoFromUrl(link),
        };
      });

    // Pinned primero
    items.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

    res.status(200).json({ ok: true, items });
  } catch (e) {
    console.error(e);
    res.status(200).json({ ok: false, items: [], error: e.message });
  }
}
