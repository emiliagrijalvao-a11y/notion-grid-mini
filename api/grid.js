// API: /api/grid
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

function pickImage(page = {}) {
  const props = page.properties || {};
  const f =
    props?.Image?.files?.[0] ||
    props?.Attachment?.files?.[0] ||
    null;

  if (f) return f.type === "file" ? f.file.url : f.external.url;

  if (props?.["Image Source"]?.url) return props["Image Source"].url;

  const cover = page.cover;
  if (cover) return cover.type === "file" ? cover.file.url : cover.external.url;

  return null;
}

export default async function handler(req, res) {
  try {
    const token = process.env.NOTION_TOKEN;
    const databaseId = process.env.NOTION_DATABASE_ID;

    // Modo demo si faltan variables (siempre devuelve algo)
    if (!token || !databaseId) {
      return res.status(200).json({
        items: [
          { id: "d1", title: "📸 Post Demo 1", image: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=800&q=60", link: null },
          { id: "d2", title: "🎨 Post Demo 2", image: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=800&q=60", link: null },
          { id: "d3", title: "✨ Post Demo 3", image: "https://images.unsplash.com/photo-1520975922203-bc1cf35f1791?auto=format&fit=crop&w=800&q=60", link: null },
          { id: "d4", title: "🌟 Post Demo 4", image: "https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=800&q=60", link: null },
          { id: "d5", title: "💫 Post Demo 5", image: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=800&q=60", link: null },
          { id: "d6", title: "🎯 Post Demo 6", image: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=800&q=60", link: null }
        ]
      });
    }

    const r = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ page_size: 100 })
    });

    const data = await r.json();

    if (!r.ok) {
      return res.status(r.status).json({ error: "Error de Notion", detail: data });
    }

    const items = (data.results || []).map((page) => ({
      id: page.id,
      title: pickTitle(page.properties || {}),
      image: pickImage(page),
      link: pickLink(page.properties || {})
    }));

    res.status(200).json({ items });
  } catch (err) {
    res.status(500).json({ error: "Server", detail: String(err) });
  }
}
