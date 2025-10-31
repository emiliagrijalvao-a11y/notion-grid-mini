// pages/api/grid.js
// Runtime: Node (no Edge). Usa CommonJS para evitar issues en Vercel.

const { Client } = require('@notionhq/client');

// ───────────────────────────────────────────────────────────
// Config
// ───────────────────────────────────────────────────────────
const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DB_CONTENT  = process.env.NOTION_DB_CONTENT;   // obligatorio
const DB_CLIENTS  = process.env.NOTION_DB_CLIENTS;   // opcional
const DB_PROJECTS = process.env.NOTION_DB_PROJECTS;  // opcional
const DB_BRANDS   = process.env.NOTION_DB_BRANDS;    // opcional

// Status mapping (Published Only)
const PUBLISHED_STATUSES = new Set(['Publicado', 'Entregado', 'Scheduled', 'Aprobado']);

// Paleta para owners (determinística)
const OWNER_COLORS = [
  '#10B981','#8B5CF6','#EC4899','#F59E0B','#3B82F6',
  '#EF4444','#FCD34D','#14B8A6','#A855F7','#22C55E'
];

// ───────────────────────────────────────────────────────────
// Helpers Notion prop safe getters
// ───────────────────────────────────────────────────────────
const getTitle = (prop) => (prop?.title || []).map(t => t.plain_text).join('').trim();
const getRich  = (prop) => (prop?.rich_text || []).map(t => t.plain_text).join('').trim();
const getDate  = (prop) => prop?.date?.start || null;
const getStatus= (prop) => prop?.status?.name || null;
const getSelect= (prop) => prop?.select?.name || null;
const getMulti = (prop) => (prop?.multi_select || []).map(s => s.name);
const getCheck = (prop) => !!prop?.checkbox;
const getPerson= (prop) => prop?.people?.[0]?.name || null;

// Rollup texto legible (ClientName/ProjectName/BrandName)
function getRollupText(prop) {
  if (!prop) return null;
  // Rollup puede devolver array de rich_text/title/people/etc.
  const arr = prop?.rollup?.array || prop?.array || prop?.results || [];
  if (Array.isArray(arr) && arr.length) {
    const first = arr[0];
    // Title
    if (first.title) return (first.title.map(t=>t.plain_text).join('') || '').trim();
    // Rich text
    if (first.rich_text) return (first.rich_text.map(t=>t.plain_text).join('') || '').trim();
    // Name directo (select)
    if (first.name) return String(first.name);
    // People
    if (first.people) return first.people[0]?.name || null;
  }
  // A veces el rollup llega como "incomplete"
  const txt = prop?.rich_text ? getRich(prop) : null;
  return (txt || null);
}

// Extraer assets desde props Attachment (files&media), Link (url), Canva (url)
function extractAssets(props) {
  const out = [];

  // Attachment (Files & media)
  const att = props.Attachment || props['Attachments'] || null;
  if (att && Array.isArray(att.files)) {
    att.files.forEach(f => {
      const url = f?.file?.url || f?.external?.url;
      if (url) out.push({
        url,
        type: guessType(url),
        source: 'attachment'
      });
    });
  }

  // Link (URL directa a media en Drive/host)
  const link = props.Link?.url || null;
  if (link) out.push({ url: link, type: guessType(link), source: 'link' });

  // Canva (URL)
  const canva = props.Canva?.url || null;
  if (canva) out.push({ url: canva, type: guessType(canva), source: 'canva' });

  return out;
}

function guessType(url = '') {
  const u = url.toLowerCase();
  if (/\.(mp4|webm|mov|m4v)(\?|$)/.test(u)) return 'video';
  if (u.includes('video')) return 'video';
  if (/\.(png|jpg|jpeg|gif|webp|avif|svg)(\?|$)/.test(u)) return 'image';
  return 'image'; // default: mostramos como imagen (el modal igual soporta <video> si aplica)
}

// Iniciales + color determinístico por owner
function ownerVisual(ownerName, ownersSorted) {
  const initials = (ownerName || '??').trim().substring(0,2).toUpperCase() || '??';
  const idx = Math.max(0, ownersSorted.indexOf(ownerName));
  const color = OWNER_COLORS[idx % OWNER_COLORS.length];
  return { initials, color };
}

// Construir filtro dinámico Notion
function buildFilter(qs) {
  const {
    status = 'published',
    client = '',
    project = '',
    brand = '',
    platform = '',
    q = '',
    show_archived = '0'
  } = qs;

  const and = [];

  // Excluir archivados/ocultos por defecto
  if (show_archived !== '1') {
    and.push({ property: 'Archivado', checkbox: { equals: false } });
  }
  and.push({ property: 'Hide', checkbox: { equals: false } });

  // Status
  if (status !== 'all') {
    and.push({
      or: Array.from(PUBLISHED_STATUSES).map(name => ({
        property: 'Status', status: { equals: name }
      }))
    });
  }

  // Client/Project/Brand via rollup legible
  if (client) {
    and.push({
      property: 'ClientName',
      rollup: { any: { rich_text: { equals: client } } }
    });
  }
  if (project) {
    and.push({
      property: 'ProjectName',
      rollup: { any: { rich_text: { equals: project } } }
    });
  }
  if (brand) {
    and.push({
      property: 'BrandName',
      rollup: { any: { rich_text: { equals: brand } } }
    });
  }

  // Platform multi-select (contenga)
  if (platform) {
    and.push({ property: 'Platform', multi_select: { contains: platform } });
  }

  // Búsqueda por título (y opcionalmente copy)
  if (q) {
    and.push({
      or: [
        { property: 'Name',  title:     { contains: q } },
        { property: 'Copy',  rich_text: { contains: q } }
      ]
    });
  }

  return and.length ? { and } : undefined;
}

// Sorts: Pinned DESC, Publish Date DESC
function buildSorts() {
  const sorts = [];
  // Si existe propiedad Pinned
  sorts.push({ property: 'Pinned', direction: 'descending' });
  // Publish Date
  sorts.push({ property: 'Publish Date', direction: 'descending' });
  return sorts;
}

// Procesar página Notion → post DTO
function normalizePost(page, ownersSorted = []) {
  const p = page.properties || {};

  const title   = getTitle(p.Name || p['Name/Post']);
  const date    = getDate(p['Publish Date']);
  const status  = getStatus(p.Status);
  const type    = getSelect(p.Type);
  const platforms = getMulti(p.Platform);
  const pinned  = getCheck(p.Pinned);
  const hidden  = getCheck(p.Hide);
  const archived= getCheck(p.Archivado);
  const owner   = getPerson(p.Owner);

  const client  = getRollupText(p.ClientName)  || null;
  const project = getRollupText(p.ProjectName) || null;
  const brand   = getRollupText(p.BrandName)   || null;

  const { initials: owner_initials, color: owner_color } = ownerVisual(owner, ownersSorted);

  const copy    = getRich(p.Copy);
  const assets  = extractAssets(p);

  return {
    id: page.id,
    title, date, status, type,
    platforms,
    client, project, brand,
    owner, owner_initials, owner_color,
    pinned, hidden, archived,
    copy,
    assets
  };
}

// Obtener lista simple (names) de otra DB (clients/projects/brands)
async function fetchNamesFromDb(dbId, max = 500) {
  if (!dbId) return [];
  let cursor = undefined;
  const names = [];
  for (;;) {
    const resp = await notion.databases.query({
      database_id: dbId,
      page_size: 100,
      start_cursor: cursor
    });
    resp.results.forEach(page => {
      const name = getTitle(page.properties?.Name);
      if (name) names.push(name);
    });
    if (!resp.has_more || names.length >= max) break;
    cursor = resp.next_cursor;
  }
  // únicos ordenados
  return Array.from(new Set(names.filter(Boolean))).sort((a,b)=>a.localeCompare(b));
}

// Paginación por "page" (step a través de cursors) o "cursor" directo
async function queryContent({ filter, sorts, limit, page, cursor }) {
  // Si hay cursor explícito, úsalo (mejor UX y más barato)
  if (cursor) {
    const resp = await notion.databases.query({
      database_id: DB_CONTENT,
      page_size: limit,
      filter,
      sorts,
      start_cursor: cursor
    });
    return resp;
  }

  // Si no hay cursor, pero hay page>0, avanzamos iterativamente.
  // (Para páginas grandes puede ser costoso; limitamos a 8 saltos)
  const MAX_STEPS = 8;
  let steps = Math.min(Math.max(parseInt(page||'0',10), 0), MAX_STEPS);
  let next = undefined;
  let resp;

  do {
    resp = await notion.databases.query({
      database_id: DB_CONTENT,
      page_size: limit,
      filter,
      sorts,
      start_cursor: next
    });
    next = resp.next_cursor;
    steps -= 1;
  } while (steps >= 0 && steps > 0 && resp.has_more && next);

  return resp;
}

// Construir owners map (conteos) desde un batch de posts recientes
function buildOwnersSummary(pages) {
  const counts = new Map();
  pages.forEach(pg => {
    const name = getPerson(pg.properties?.Owner);
    if (name) counts.set(name, (counts.get(name) || 0) + 1);
  });
  const owners = Array.from(counts.entries())
    .sort((a,b)=> b[1]-a[1])
    .map(([name, count], idx) => {
      const { initials, color } = ownerVisual(name, Array.from(counts.keys()).sort());
      return { name, count, color, initials };
    });
  const sortedNames = owners.map(o => o.name);
  return { owners, sortedNames };
}

// ───────────────────────────────────────────────────────────
// Handler
// ───────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  try {
    if (!DB_CONTENT) {
      res.status(500).json({ ok:false, error: 'Missing NOTION_DB_CONTENT env var' });
      return;
    }

    const {
      meta = '0',
      limit = '12',
      page  = '0',
      cursor = '',
      status = 'published',
      client = '',
      project = '',
      brand = '',
      platform = '',
      q = '',
      show_archived = '0'
    } = req.query || {};

    // META: listas para selects (rápido y autónomo)
    if (meta === '1') {
      // Intentamos obtener desde DBs separadas (preferido)
      const [clients, projects, brands] = await Promise.all([
        fetchNamesFromDb(DB_CLIENTS).catch(()=>[]),
        fetchNamesFromDb(DB_PROJECTS).catch(()=>[]),
        fetchNamesFromDb(DB_BRANDS).catch(()=>[]),
      ]);

      // Como backup: también leemos un batch de Content para platforms/owners
      const backupBatch = await notion.databases.query({
        database_id: DB_CONTENT,
        page_size: 100,
        sorts: buildSorts()
      });

      // Platforms desde los posts
      const platformsSet = new Set();
      backupBatch.results.forEach(pg => {
        getMulti(pg.properties?.Platform).forEach(p => platformsSet.add(p));
      });

      // Owners summary (para panel de owners si lo usas)
      const { owners } = buildOwnersSummary(backupBatch.results);

      res.status(200).json({
        ok: true,
        filters: {
          clients,
          projects,
          brands,
          platforms: Array.from(platformsSet),
          owners
        }
      });
      return;
    }

    const limitNum = Math.min(Math.max(parseInt(limit,10)||12, 1), 100);

    // Build filter/sorts
    const filter = buildFilter({ status, client, project, brand, platform, q, show_archived });
    const sorts  = buildSorts();

    // Query content
    const resp = await queryContent({ filter, sorts, limit: limitNum, page, cursor });

    // Owners base para color estable (alfabético)
    const allOwnerNames = Array.from(new Set(
      resp.results.map(pg => getPerson(pg.properties?.Owner)).filter(Boolean)
    )).sort();

    // Normalize posts
    const posts = resp.results.map(pg => normalizePost(pg, allOwnerNames));

    res.status(200).json({
      ok: true,
      posts,
      has_more: resp.has_more,
      next_cursor: resp.next_cursor || null
    });

  } catch (err) {
    console.error('GRID API ERROR:', err);
    // Evitar filtrar info sensible, pero mostrar pista útil
    res.status(500).send('INTERNAL_SERVER_ERROR');
  }
};
