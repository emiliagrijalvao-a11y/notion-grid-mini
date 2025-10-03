// /api/grid.js  — Vercel Node.js (CommonJS)
// Lee una Database de Notion y devuelve hasta 12 ítems listos para el grid.

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const NOTION_VERSION = "2022-06-28";

export default async function handler(req, res) {
  if (!NOTION_TOKEN || !NOTION_DATABASE_ID) {
    res.status(400).json({ ok: false, error: "Missing NOTION envs" });
    return;
  }

  try {
    const url = `https://api.notion.com/v1/databases/${NOTION_DATABASE_ID}/query`;

    // Traemos hasta 100 y filtramos del lado del server (más flexible).
    const r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${NOTION_TOKEN}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ page_size: 100 }),
    });

    if (!r.ok) {
      const text = await r.text();
      res.status(400).json({ ok: false, error: "Notion query failed", detail: text });
      return;
    }

    const data = await r.json();
    const pages = data.results || [];

    // Helpers
    const pickProp = (props, names) => {
      for (const n of names) if (props?.[n]) return props[n];
      return undefined;
    };
    const rich = (prop) =>
      (prop?.rich_text || prop?.title || [])
        .map((t) => t.plain_text || "")
        .join("")
        .trim();
    const checkbox = (prop) => !!prop?.checkbox;
    const dateStart = (prop) => prop?.date?.start || null;
    const sel = (prop) => (prop?.select ? prop.select.name : null);
    const multi = (prop) => (prop?.multi_select || []).map((o) => o.name);

    const isVideoUrl = (u = "") => /\.(mp4|mov|webm)(\?|$)/i.test(u);

    const readImageOrVideo = (props, page) => {
      // 1) Files/Attachment
      const attach = pickProp(props, ["Attachment", "Image", "Image 1", "Image Files"]);
      let fileUrl =
        attach?.files?.[0]?.file?.url ||
        attach?.files?.[0]?.external?.url ||
        null;

      // 2) Image Source (url)
      if (!fileUrl) {
        const src = pickProp(props, ["Image Source", "Image URL", "Link", "URL"]);
        const urlFromText = typeof src?.url === "string" ? src.url : rich(src);
        if (urlFromText) fileUrl = urlFromText;
      }

      // 3) Cover de la página
      if (!fileUrl && page?.cover) {
        fileUrl = page.cover.type === "file" ? page.cover.file.url : page.cover.external.url;
      }

      if (!fileUrl) return null;

      if (isVideoUrl(fileUrl)) {
        return { kind: "video", url: fileUrl };
      }
      return { kind: "image", url: fileUrl };
    };

    const items = pages.map((page) => {
      const props = page.properties || {};

      const nameProp = pickProp(props, ["Name", "Title"]);
      const title = rich(nameProp) || "Sin título";

      const captionProp = pickProp(props, ["Caption", "Descripción", "Description"]);
      const caption = rich(captionProp) || "";

      const linkProp = pickProp(props, ["Link", "URL"]);
      const link =
        (typeof linkProp?.url === "string" && linkProp.url) || rich(linkProp) || null;

      const pinnedProp = pickProp(props, ["Pinned", "Pin", "Destacado"]);
      const hideProp = pickProp(props, ["Hide", "Hidden", "Ocultar"]);

      const dateProp = pickProp(props, ["Publish Date", "Date", "Fecha"]);
      const publishDate = dateStart(dateProp);

      const platformProp = pickProp(props, ["Platform", "Platforms", "Plataforma"]);
      const platforms = platformProp
        ? (multi(platformProp).length ? multi(platformProp) : [sel(platformProp)].filter(Boolean))
        : [];

      const statusProp = pickProp(props, ["Status", "Estado"]);
      const status = sel(statusProp) || rich(statusProp) || null;

      const media = readImageOrVideo(props, page);

      return {
        id: page.id,
        title,
        caption,
        link,
        pinned: checkbox(pinnedProp),
        hide: checkbox(hideProp),
        publishDate, // string ISO o null
        platforms,   // array de strings
        status,      // string o null
        media,       // {kind:"image"|"video", url} | null
      };
    });

    // Filtros por query: ?platform=Tik%20Tok,Instagram&status=Done&limit=12
    const { platform = "", status = "", limit = "12" } = req.query;
    const wantPlatforms = platform
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const wantStatus = status
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    let filtered = items.filter((it) => !it.hide && it.media);

    if (wantPlatforms.length) {
      filtered = filtered.filter((it) =>
        it.platforms.some((p) => wantPlatforms.includes(p))
      );
    }
    if (wantStatus.length) {
      filtered = filtered.filter((it) => it.status && wantStatus.includes(it.status));
    }

    // Orden: Pinned primero, luego por fecha desc (si hay), luego por título.
    filtered.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      const da = a.publishDate ? Date.parse(a.publishDate) : 0;
      const db = b.publishDate ? Date.parse(b.publishDate) : 0;
      if (db !== da) return db - da;
      return a.title.localeCompare(b.title);
    });

    const lim = Math.max(1, Math.min(50, parseInt(limit, 10) || 12));
    const sliced = filtered.slice(0, lim);

    res.status(200).json({ ok: true, items: sliced });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
}
