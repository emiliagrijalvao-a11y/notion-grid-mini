// api/grid.js
import { Client } from "@notionhq/client";

// 1) LEER VARIABLES con fallback de nombres
const NOTION_TOKEN =
  process.env.NOTION_TOKEN ||
  process.env.NOTION_API_TOKEN ||
  process.env.NOTION_SECRET;

const NOTION_DB_ID =
  process.env.NOTION_DB_ID ||
  process.env.NOTION_DATABASE_ID || // <-- el que tú tienes en Vercel
  process.env.NOTION_DB ||
  process.env.NOTION_CONTENT_DB_ID;

function error(res, msg, status = 500) {
  return res.status(status).json({ ok: false, error: msg });
}

// 2) validar antes de crear cliente
export default async function handler(req, res) {
  if (!NOTION_TOKEN || !NOTION_DB_ID) {
    return error(res, "Missing NOTION_TOKEN or NOTION_DB_ID");
  }

  const notion = new Client({ auth: NOTION_TOKEN });

  // leer query
  const {
    cursor,
    limit = "12",
    status = "published",
    client,
    project,
    brand,
    platform,
    q,
    meta,
  } = req.query;

  // 3) armar filtro base
  const andFilter = [
    // excluir ocultos y archivados siempre
    {
      property: "Hide",
      checkbox: { equals: false },
    },
    {
      property: "Archivado",
      checkbox: { equals: false },
    },
  ];

  // status logic
  if (status && status !== "all" && status !== "All") {
    // “Published Only” → dejamos pasar varios estados
    andFilter.push({
      or: [
        { property: "Status", status: { equals: "Publicado" } },
        { property: "Status", status: { equals: "Entregado" } },
        { property: "Status", status: { equals: "Aprobado" } },
        { property: "Status", status: { equals: "Scheduled" } },
      ],
    });
  }

  // filtros opcionales
  if (client && client !== "all" && client !== "") {
    // tu Notion tiene relation PostClient + rollup ClientName
    andFilter.push({
      property: "ClientName",
      rich_text: { equals: client },
    });
  }

  if (project && project !== "all" && project !== "") {
    andFilter.push({
      property: "ProjectName",
      rich_text: { equals: project },
    });
  }

  if (brand && brand !== "all" && brand !== "") {
    andFilter.push({
      property: "BrandName",
      rich_text: { equals: brand },
    });
  }

  if (platform && platform !== "all" && platform !== "") {
    andFilter.push({
      property: "Platform",
      multi_select: { contains: platform },
    });
  }

  if (q && q.trim() !== "") {
    andFilter.push({
      property: "Post",
      title: { contains: q.trim() },
    });
  }

  // 4) construir payload Notion
  const queryPayload = {
    database_id: NOTION_DB_ID,
    filter: {
      and: andFilter,
    },
    sorts: [
      // primero pineados
      {
        property: "Pinned",
        direction: "descending",
      },
      // luego por fecha
      {
        property: "Publish Date",
        direction: "descending",
      },
    ],
    page_size: Number(limit) || 12,
  };

  if (cursor) {
    queryPayload.start_cursor = cursor;
  }

  try {
    const resp = await notion.databases.query(queryPayload);

    const posts = resp.results.map(mapNotionPageToPost);

    // si solo piden meta
    if (meta === "1" || meta === "true") {
      const filters = buildFiltersFromPosts(posts);
      return res.status(200).json({
        ok: true,
        posts,
        filters,
        has_more: resp.has_more,
        next_cursor: resp.next_cursor || null,
      });
    }

    return res.status(200).json({
      ok: true,
      posts,
      has_more: resp.has_more,
      next_cursor: resp.next_cursor || null,
    });
  } catch (err) {
    console.error("Notion error:", err.body || err.message || err);
    return error(
      res,
      err.body?.message || err.message || "Error querying Notion",
      500
    );
  }
}

/* ============ HELPERS ============ */

function mapNotionPageToPost(page) {
  const props = page.properties || {};

  // title
  const title =
    (props.Post?.title || props.Name?.title || [])
      .map((t) => t.plain_text)
      .join("") || "Sin título";

  // date
  const date =
    props["Publish Date"]?.date?.start ||
    props["Fecha"]?.date?.start ||
    null;

  // status
  const status =
    props.Status?.status?.name ||
    props.Estado?.status?.name ||
    null;

  // owner
  const owner =
    props.Owner?.people?.[0]?.name ||
    props.Responsable?.people?.[0]?.name ||
    null;

  // copy
  const copy = (props.Copy?.rich_text || [])
    .map((t) => t.plain_text)
    .join("");

  // platforms
  const platforms =
    props.Platform?.multi_select?.map((p) => p.name) || [];

  // client / project / brand (rollups)
  const client =
    readRollupString(props.ClientName) ||
    readRelationName(props.PostClient) ||
    null;

  const project =
    readRollupString(props.ProjectName) ||
    readRelationName(props.PostProject) ||
    null;

  const brand =
    readRollupString(props.BrandName) ||
    readRelationName(props.PostBrands) ||
    null;

  // pinned / hidden / archived
  const pinned = props.Pinned?.checkbox || false;
  const hidden = props.Hide?.checkbox || false;
  const archived = props.Archivado?.checkbox || false;

  // assets
  const assets = extractAssets(props);

  return {
    id: page.id,
    title,
    date,
    status,
    platforms,
    client,
    project,
    brand,
    owner,
    pinned,
    hidden,
    archived,
    copy,
    assets,
  };
}

function readRollupString(prop) {
  if (!prop) return null;
  // rollup te puede devolver array de rich_text
  if (Array.isArray(prop.rollup?.array) && prop.rollup.array.length > 0) {
    const first = prop.rollup.array[0];
    if (first.title && first.title.length) {
      return first.title.map((t) => t.plain_text).join("");
    }
    if (first.rich_text && first.rich_text.length) {
      return first.rich_text.map((t) => t.plain_text).join("");
    }
    if (first.name) return first.name;
  }
  // a veces es directamente rich_text:
  if (Array.isArray(prop.rich_text) && prop.rich_text.length) {
    return prop.rich_text.map((t) => t.plain_text).join("");
  }
  return null;
}

function readRelationName(prop) {
  // fallback si no hay rollup
  if (!prop) return null;
  if (Array.isArray(prop.relation) && prop.relation.length) {
    // devolvemos solo “(relation)” porque sin otra query no tenemos el nombre
    return "(relation)";
  }
  return null;
}

function extractAssets(props) {
  // prioridad 1: Attachment (files)
  if (props.Attachment?.files?.length) {
    return props.Attachment.files.map((f) => ({
      url: f.file?.url || f.external?.url,
      type: guessAssetType(f.file?.url || f.external?.url),
      source: "attachment",
    }));
  }

  // prioridad 2: Link
  if (props.Link?.url) {
    return [
      {
        url: props.Link.url,
        type: guessAssetType(props.Link.url),
        source: "link",
      },
    ];
  }

  // prioridad 3: Canva
  if (props.Canva?.url) {
    return [
      {
        url: props.Canva.url,
        type: "image",
        source: "canva",
      },
    ];
  }

  return [];
}

function guessAssetType(url) {
  if (!url) return "image";
  const lower = url.toLowerCase();
  if (lower.includes(".mp4") || lower.includes("video")) return "video";
  return "image";
}

function buildFiltersFromPosts(posts) {
  const clients = new Set();
  const projects = new Set();
  const brands = new Set();
  const owners = new Map();

  posts.forEach((p) => {
    if (p.client) clients.add(p.client);
    if (p.project) projects.add(p.project);
    if (p.brand) brands.add(p.brand);
    if (p.owner) {
      if (!owners.has(p.owner)) owners.set(p.owner, 0);
      owners.set(p.owner, owners.get(p.owner) + 1);
    }
  });

  // asignar colores determinísticos
  const OWNER_COLORS = [
    "#10B981",
    "#8B5CF6",
    "#EC4899",
    "#F59E0B",
    "#3B82F6",
    "#EF4444",
    "#FCD34D",
    "#14B8A6",
  ];

  const ownerArr = Array.from(owners.entries()).map(
    ([name, count], idx) => ({
      name,
      count,
      color: OWNER_COLORS[idx % OWNER_COLORS.length],
      initials: name.slice(0, 2).toUpperCase(),
    })
  );

  return {
    clients: Array.from(clients).sort(),
    projects: Array.from(projects).sort(),
    brands: Array.from(brands).sort(),
    platforms: [
      "Instagram",
      "Tiktok",
      "Youtube",
      "Facebook",
      "Página web",
      "Pantalla",
    ],
    owners: ownerArr,
  };
}
