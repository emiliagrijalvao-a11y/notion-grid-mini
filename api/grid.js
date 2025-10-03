const NOTION_VERSION = "2022-06-28";

function pickTitle(props = {}) {
  const name = props?.Name?.title?.[0]?.plain_text;
  const caption = props?.Caption?.rich_text?.[0]?.plain_text;
  const titleRt = props?.Title?.rich_text?.[0]?.plain_text;
  return name || caption || titleRt || "Sin título";
}
function pickLink(props = {}) {
  return props?.Link?.url || props?.URL?.url || null;
}
function pickImage(page) {
  const props = page.properties || {};
  const f =
    props?.Image?.files?.[0] ||
    props?.Cover?.files?.[0] ||
    props?.Attachment?.files?.[0] ||
    null;
  if (f) return f.type === "file" ? f.file.url : f.external.url;

  if (props?.["Image Source"]?.url) return props["Image Source"].url;

  const cover = page.cover;
  if (cover) return cover.type === "file" ? cover.file.url : cover.external.url;
  return null;
}
function pickDate(page, props = {}, dateKey) {
  if (dateKey && props?.[dateKey]?.date?.start) return props[dateKey].date.start;
  const guess = props?.Date?.date?.start || props?.Fecha?.date?.start ||
                props?.Published?.date?.start || props?.["Publish Date"]?.date?.start;
  return guess || page.created_time || page.last_edited_time || null;
}
function pickPlatform(props = {}, platformKey) {
  if (platformKey) return props?.[platformKey]?.select?.name || null;
  return props?.Platform?.select?.name || props?.Plataforma?.select?.name || null;
}
function pickStatus(props = {}, statusKey) {
  if (statusKey) {
    return props?.[statusKey]?.status?.name || props?.[statusKey]?.select?.name || null;
  }
  return (
    props?.Status?.status?.name ||
    props?.Status?.select?.name ||
    props?.Estado?.status?.name ||
    props?.Estado?.select?.name ||
    null
  );
}
function pickPinned(props = {}) {
  const pin =
    props?.Pinned?.checkbox ||
    props?.Destacado?.checkbox ||
    false;
  if (pin) return true;
  const tags = props?.Tags?.multi_select || props?.Etiquetas?.multi_select || [];
  return tags.some(t => /highlight|destacado|pin/i.test(t.name || ""));
}

async function notionFetch(url, options, token) {
  const headers = {
    Authorization: `Bearer ${token}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

export default async function handler(req, res) {
  try {
    const token = process.env.NOTION_TOKEN;
    const databaseId = process.env.NOTION_DATABASE_ID;

    if (!token || !databaseId) {
      // modo demo (sin romper)
      return res.status(200).json({
        items: [
          { id:'d1', title:'Post Demo 1', image:'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=1200&q=60', date:'2024-02-25', platform:'Instagram', status:'Approved', link:null, pinned:true },
          { id:'d2', title:'Post Demo 2', image:'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=1200&q=60', date:'2024-03-01', platform:'Instagram', status:'Draft', link:null, pinned:false },
          { id:'d3', title:'Post Demo 3', image:'https://images.unsplash.com/photo-1520975922203-bc1cf35f1791?auto=format&fit=crop&w=1200&q=60', date:'2024-03-10', platform:'Instagram', status:'Approved', link:null, pinned:true }
        ]
      });
    }

    // 1) Leemos metadata para detectar nombres reales de propiedades
    const { res: metaRes, data: meta } = await notionFetch(
      `https://api.notion.com/v1/databases/${databaseId}`,
      { method: "GET" },
      token
    );
    if (!metaRes.ok) {
      return res.status(metaRes.status).json({ error: "Notion meta error", detail: meta });
    }
    const props = meta.properties || {};
    const keys = Object.keys(props);

    const dateKey = keys.find(k => props[k]?.type === "date" && /^(date|fecha|published|publish date)$/i.test(k)) ||
                    keys.find(k => props[k]?.type === "date"); // fallback: primer date

    const platformKey = keys.find(k => props[k]?.type === "select" && /^(platform|plataforma)$/i.test(k));
    // status puede ser "status" o "select"
    const statusKey = keys.find(k => /^(status|estado)$/i.test(k) && (props[k]?.type === "status" || props[k]?.type === "select"));

    // 2) Query con sort solo si tenemos dateKey
    const body = dateKey ? { page_size: 100, sorts: [{ property: dateKey, direction: "descending" }] }
                         : { page_size: 100 };

    const { res: qRes, data: qData } = await notionFetch(
      `https://api.notion.com/v1/databases/${databaseId}/query`,
      { method: "POST", body: JSON.stringify(body) },
      token
    );
    if (!qRes.ok) {
      return res.status(qRes.status).json({ error: "Notion query error", detail: qData });
    }

    const items = (qData.results || []).map(page => {
      const p = page.properties || {};
      return {
        id: page.id,
        title: pickTitle(p),
        image: pickImage(page),
        link: pickLink(p),
        date: pickDate(page, p, dateKey),
        platform: pickPlatform(p, platformKey),
        status: pickStatus(p, statusKey),
        pinned: pickPinned(p)
      };
    });

    res.status(200).json({ items });
  } catch (e) {
    console.error("API /api/grid error:", e);
    res.status(500).json({ error: "Server error", detail: String(e) });
  }
}
