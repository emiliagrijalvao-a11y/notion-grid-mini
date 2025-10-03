// /api/grid.js — Notion → JSON para el grid (máx 12)
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const NOTION_VERSION = "2022-06-28";

module.exports = async (req, res) => {
  if (!NOTION_TOKEN || !NOTION_DATABASE_ID) {
    res.status(400).json({ ok: false, error: "Missing NOTION_TOKEN/NOTION_DATABASE_ID" });
    return;
  }

  try {
    const r = await fetch(
      `https://api.notion.com/v1/databases/${NOTION_DATABASE_ID}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${NOTION_TOKEN}`,
          "Notion-Version": NOTION_VERSION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ page_size: 100 }),
      }
    );

    if (!r.ok) {
      const text = await r.text();
      res.status(400).json({ ok: false, error: "Notion query failed", detail: text });
      return;
    }

    const data = await r.json();
    const pages = data.results || [];

    // helpers
    const pick = (props, names) => names.find((n) => props?.[n]) && props[names.find((n)=>props[n])];
    const rich = (p) => (p?.rich_text || p?.title || []).map(t => t.plain_text || "").join("").trim();
    const sel  = (p) => (p?.select ? p.select.name : null);
    const multi= (p) => (p?.multi_select || []).map(o=>o.name);
    const cb   = (p) => !!p?.checkbox;
    const dateStart = (p) => p?.date?.start || null;
    const isVideo = (u="") => /\.(mp4|mov|webm)(\?|$)/i.test(u);

    const readMedia = (props, page) => {
      const attach = pick(props, ["Attachment","Image","Image 1","Image Files"]);
      let url = attach?.files?.[0]?.file?.url || attach?.files?.[0]?.external?.url || null;
      if (!url) {
        const src = pick(props, ["Image Source","Image URL","Link","URL"]);
        const val = typeof src?.url === "string" ? src.url : rich(src);
        if (val) url = val;
      }
      if (!url && page?.cover) url = page.cover.type==="file" ? page.cover.file.url : page.cover.external.url;
      if (!url) return null;
      return isVideo(url) ? { kind:"video", url } : { kind:"image", url };
    };

    const items = pages.map((page) => {
      const props = page.properties || {};
      const title = rich(pick(props, ["Name","Title"])) || "Sin título";
      const caption = rich(pick(props, ["Caption","Descripción","Description"])) || "";
      const linkP = pick(props, ["Link","URL"]);
      const link = (typeof linkP?.url === "string" && linkP.url) || rich(linkP) || null;

      const pinned = cb(pick(props, ["Pinned","Pin","Destacado"]));
      const hide   = cb(pick(props, ["Hide","Hidden","Ocultar"]));

      const publishDate = dateStart(pick(props, ["Publish Date","Date","Fecha"]));

      const platProp = pick(props, ["Platform","Platforms","Plataforma"]);
      const platforms = platProp
        ? (multi(platProp).length ? multi(platProp) : [sel(platProp)].filter(Boolean))
        : [];

      const status = sel(pick(props, ["Status","Estado"])) || "";

      const media = readMedia(props, page);

      return { id: page.id, title, caption, link, pinned, hide, publishDate, platforms, status, media };
    });

    // filtros
    const { platform = "", status = "", limit = "12" } = req.query;
    const wantP = platform.split(",").map(s=>s.trim()).filter(Boolean);
    const wantS = status.split(",").map(s=>s.trim()).filter(Boolean);

    let filtered = items.filter(it => !it.hide && it.media);
    if (wantP.length) filtered = filtered.filter(it => it.platforms.some(p => wantP.includes(p)));
    if (wantS.length) filtered = filtered.filter(it => wantS.includes(it.status));

    // orden: pinned, fecha desc, título
    filtered.sort((a,b)=>{
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      const da = a.publishDate ? Date.parse(a.publishDate) : 0;
      const db = b.publishDate ? Date.parse(b.publishDate) : 0;
      if (db !== da) return db - da;
      return a.title.localeCompare(b.title);
    });

    const LIM = Math.max(1, Math.min(50, parseInt(limit,10) || 12));
    res.status(200).json({ ok: true, items: filtered.slice(0, LIM) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
};
