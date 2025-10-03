const NOTION_VERSION = "2022-06-28";

/* Helpers para leer propiedades con nombres variables */
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
  const f = props?.Image?.files?.[0] || props?.Attachment?.files?.[0] || null;
  if (f) return f.type === "file" ? f.file.url : f.external.url;
  if (props?.["Image Source"]?.url) return props["Image Source"].url;
  const cover = page.cover;
  if (cover) return cover.type === "file" ? cover.file.url : cover.external.url;
  return null;
}
function pickVideo(page){
  const props = page.properties || {};
  const f = props?.Video?.files?.[0] || null;
  if (!f) return null;
  return f.type === "file" ? f.file.url : f.external.url;
}
function pickPlatforms(props = {}) {
  const candidates = [props.Platforms, props.Platform, props.Plataformas, props.Plataforma];
  const p = candidates.find(Boolean);
  if (!p) return [];
  if (p.type === "multi_select") return p.multi_select.map(o => o.name);
  if (p.type === "select") return p.select ? [p.select.name] : [];
  if (p.type === "rich_text") return p.rich_text.map(r => r.plain_text).filter(Boolean);
  return [];
}
function pickStatus(props = {}) {
  const candidates = [props.Status, props.Estado, props.State];
  const s = candidates.find(Boolean);
  if (!s) return null;
  if (s.type === "select") return s.select ? s.select.name : null;
  if (s.type === "rich_text") return s.rich_text?.[0]?.plain_text || null;
  return null;
}
function pickPinned(props = {}) {
  const candidates = [props.Pinned, props.Pin, props.Star, props["⭐ Pin"]];
  const c = candidates.find(Boolean);
  return !!(c && c.checkbox === true);
}
function pickDate(props = {}) {
  const candidates = [props.Date, props.Fecha, props.Published];
  const d = candidates.find(Boolean);
  return d?.date?.start || null;
}
function pickTags(props = {}) {
  const candidates = [props.Tags, props.Labels, props.Etiquetas];
  const t = candidates.find(Boolean);
  if (!t) return [];
  if (t.type === "multi_select") return t.multi_select.map(x=>x.name);
  return [];
}

export default async function handler(req, res) {
  try {
    const token = process.env.NOTION_TOKEN;
    const databaseId = process.env.NOTION_DATABASE_ID;

    // Modo DEMO si faltan credenciales
    if (!token || !databaseId) {
      return res.status(200).json({
        items: [
          { id:"d1", title:"Post Demo 1", image:"https://images.unsplash.com/photo-1469474968028-56623f02e42e?q=80&w=1200&auto=format&fit=crop", link:null, platforms:["Instagram"], status:"Done", pinned:true, date:"2025-02-21", tags:["serum"] },
          { id:"d2", title:"Post Demo 2", image:"https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=1200&auto=format&fit=crop", link:null, platforms:["Tiktok"], status:"In progress", pinned:false, date:"2025-02-19", tags:["30 serum"] },
          { id:"d3", title:"Post Demo 3", image:"https://images.unsplash.com/photo-1517841905240-472988babdf9?q=80&w=1200&auto=format&fit=crop", link:null, platforms:["Others"], status:"Not started", pinned:false, date:"2025-02-17", tags:["cream"] },
        ],
      });
    }

    const response = await fetch(
      `https://api.notion.com/v1/databases/${databaseId}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": NOTION_VERSION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          page_size: 100,
          sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
        }),
      }
    );

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({
        error: "Notion error",
        detail: data,
        message: "Verifica que la integración tenga acceso a la base de datos",
      });
    }

    const items = (data.results || []).map((page) => {
      const props = page.properties || {};
      return {
        id: page.id,
        title: pickTitle(props),
        image: pickImage(page),
        video: pickVideo(page),
        link: pickLink(props),
        platforms: pickPlatforms(props),   // ["Instagram","Tiktok","Others"]
        status: pickStatus(props),         // "Not started" | "In progress" | "Done"
        pinned: pickPinned(props),         // true/false
        date: pickDate(props),             // ISO
        tags: pickTags(props),             // ["serum","cream",...]
      };
    });

    res.status(200).json({ items, count: items.length });
  } catch (error) {
    console.error("Error /api/grid:", error);
    res.status(500).json({ error: "Server error", detail: error.message });
  }
}
