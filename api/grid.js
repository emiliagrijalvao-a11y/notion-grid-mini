// API simple estilo Vercel (Node >=18)
const NOTION_VERSION = "2022-06-28";

// ——— helpers para extraer campos comunes aunque tus propiedades tengan otros nombres ———
function pickTitle(props = {}) {
  const name = props?.Name?.title?.[0]?.plain_text;
  const caption = props?.Caption?.rich_text?.[0]?.plain_text;
  const titleRt = props?.Title?.rich_text?.[0]?.plain_text;
  return name || caption || titleRt || "Sin título";
}

function pickLink(props = {}) {
  return props?.Link?.url || props?.URL?.url || null;
}

function pickDate(page, props = {}) {
  const p = props?.Date?.date?.start || props?.Fecha?.date?.start;
  return p || page?.created_time || page?.last_edited_time || null;
}

function pickPlatform(props = {}) {
  return (
    props?.Platform?.select?.name ||
    props?.Plataforma?.select?.name ||
    null
  );
}

function pickStatus(props = {}) {
  // Soporta "status" y "select"
  return (
    props?.Status?.status?.name ||
    props?.Status?.select?.name ||
    props?.Estado?.status?.name ||
    props?.Estado?.select?.name ||
    null
  );
}

function pickImage(page) {
  const props = page.properties || {};
  const fileObj =
    props?.Image?.files?.[0] ||
    props?.Cover?.files?.[0] ||
    props?.Attachment?.files?.[0] ||
    null;

  if (fileObj) {
    return fileObj.type === "file" ? fileObj.file.url : fileObj.external.url;
  }

  // Campo “Image Source” (URL)
  if (props?.["Image Source"]?.url) {
    return props["Image Source"].url;
  }

  // Fallback: cover de la página
  const cover = page.cover;
  if (cover) {
    return cover.type === "file" ? cover.file.url : cover.external.url;
  }

  return null;
}

export default async function handler(req, res) {
  try {
    const token = process.env.NOTION_TOKEN;
    const databaseId = process.env.NOTION_DATABASE_ID;

    // Demo si faltan credenciales
    if (!token || !databaseId) {
      return res.status(200).json({
        items: [
          { id: "d1", title: "Post Demo 1", image: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=60", date: "2024-02-25", platform: "Instagram", status: "Approved", link: null },
          { id: "d2", title: "Post Demo 2", image: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=1200&q=60", date: "2024-03-01", platform: "Instagram", status: "Draft", link: null },
          { id: "d3", title: "Post Demo 3", image: "https://images.unsplash.com/photo-1520975922203-bc1cf35f1791?auto=format&fit=crop&w=1200&q=60", date: "2024-03-10", platform: "Instagram", status: "Approved", link: null }
        ]
      });
    }

    const resp = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        page_size: 100,
        sorts: [
          // si tienes “Date/Fecha”, ordena por fecha desc; si no, Notion ignora este sort
          { property: "Date", direction: "descending" }
        ]
      })
    });

    const data = await resp.json();

    if (!resp.ok) {
      return res.status(resp.status).json({
        error: "Notion error",
        detail: data
      });
    }

    const items = (data.results || []).map((page) => {
      const props = page.properties || {};
      return {
        id: page.id,
        title: pickTitle(props),
        image: pickImage(page),
        link: pickLink(props),
        date: pickDate(page, props),
        platform: pickPlatform(props),
        status: pickStatus(props)
      };
    });

    res.status(200).json({ items });
  } catch (e) {
    console.error("API /api/grid error:", e);
    res.status(500).json({ error: "Server error", detail: String(e) });
  }
}
