// api/grid.js — versión tolerante al esquema (safe filters)

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

/* ---------- util ---------- */
function titleText(p){ return Array.isArray(p?.title) ? p.title.map(t=>t.plain_text).join('') : ''; }
function dateValue(p){ return (p?.date?.start) || (p?.date?.start===null?null:undefined); }
function multiSelectNames(p){ return Array.isArray(p?.multi_select) ? p.multi_select.map(x=>x.name) : []; }
function isVideoName(name){ if(!name) return false; const s=name.toLowerCase(); return ['.mp4','.webm','.mov','.m4v','.avi','.mkv'].some(ext=>s.endsWith(ext)); }

function extractAssets(props){
  const out=[];
  const files = props.Attachment?.files || props.Files?.files || props.Media?.files || [];
  files.forEach(f=>{
    const url = f.type==='external' ? f.external.url : f.file.url;
    out.push({ url, type: isVideoName(f.name) ? 'video' : 'image', source:'attachment' });
  });
  if (!out.length){
    const link = props.Link?.url || props.Canva?.url;
    if (link) out.push({ url: link, type: isVideoName(link)?'video':'image', source:'link' });
  }
  return out;
}

function rollupText(p){
  if (!p) return '';
  if (p.rollup && p.rollup.array && p.rollup.array[0]) {
    const a = p.rollup.array[0];
    if (a.title && a.title.length) return a.title.map(t=>t.plain_text).join('');
    if (a.rich_text && a.rich_text.length) return a.rich_text.map(t=>t.plain_text).join('');
    if (a.name) return a.name;
  }
  if (Array.isArray(p.rich_text)) return p.rich_text.map(t=>t.plain_text).join('');
  return '';
}

/* ---------- nombres aceptados ---------- */
const NAMES = {
  NAME:      ['Name','Post','Título','Title'],
  DATE:      ['Publish Date','Fecha'],
  STATUS:    ['Status','Estado'],
  PLATFORM:  ['Platform','Plataforma','Platforms'],
  TYPE:      ['Type','Tipo'],
  OWNER:     ['Owner','Propietario','Responsable'],

  ARCHIVED:  ['Archivado','Archived'],
  HIDE:      ['Hide','Hidden','Oculto'],

  CLIENT_ROLL:  ['ClientName','Cliente','Client'],
  PROJECT_ROLL: ['ProjectName','Proyecto','Project'],
  BRAND_ROLL:   ['BrandName','Marca','Brand'],

  COPY:      ['Copy','Caption','Texto'],
};

/* ---------- helpers de esquema ---------- */
async function getSchema(){
  const r = await fetch(`${NOTION_API}/databases/${process.env.NOTION_DATABASE_ID}`,{
    headers:{
      'Authorization':`Bearer ${process.env.NOTION_TOKEN}`,
      'Notion-Version':NOTION_VERSION
    }
  });
  if (!r.ok) throw new Error('Cannot read Notion schema');
  const j = await r.json();
  return j.properties || {};
}
function pickName(existingProps, aliases){
  // devuelve el primer nombre que exista en el schema
  for (const a of aliases){ if (existingProps[a]) return a; }
  return null;
}
function safeProp(obj, key){ return key ? obj[key] : undefined; }

/* ---------- mapeo de un post ---------- */
function processPost(p, map){
  const props = p.properties || {};
  const title = titleText(safeProp(props, map.NAME)) || 'Untitled';
  const date  = dateValue( safeProp(props, map.DATE) ) || '';
  const status= safeProp(props, map.STATUS)?.status?.name || '';
  const type  = safeProp(props, map.TYPE)?.select?.name || '';
  const platforms = multiSelectNames( safeProp(props, map.PLATFORM) );

  const client = rollupText(safeProp(props, map.CLIENT_ROLL));
  const project= rollupText(safeProp(props, map.PROJECT_ROLL));
  const brand  = rollupText(safeProp(props, map.BRAND_ROLL));

  const owner  = safeProp(props, map.OWNER)?.people?.[0]?.name || '';
  const owner_initials = owner ? owner.slice(0,2).toUpperCase() : '';
  const palette=['#10B981','#8B5CF6','#EC4899','#F59E0B','#3B82F6','#EF4444','#FCD34D','#14B8A6','#A855F7','#22C55E'];
  let hash=0; for (let i=0;i<owner.length;i++) hash=(hash*31+owner.charCodeAt(i))|0;
  const owner_color = owner ? palette[Math.abs(hash)%palette.length] : '';

  const archived = !!(safeProp(props, map.ARCHIVED)?.checkbox);
  const hidden   = !!(safeProp(props, map.HIDE)?.checkbox);

  const copyText = (safeProp(props, map.COPY)?.rich_text||[]).map(t=>t.plain_text).join('');

  return {
    id:p.id, title, date, status, type, platforms, client, project, brand,
    owner, owner_initials, owner_color,
    archived, hidden,
    pinned: !!props.Pinned?.checkbox,
    copy: copyText,
    assets: extractAssets(props)
  };
}

/* ---------- filtros seguros ---------- */
function buildFilters(map, q){
  const and = [];

  // toggles (solo si existen)
  if (map.ARCHIVED) and.push({ property: map.ARCHIVED, checkbox:{ equals:false }});
  if (map.HIDE)     and.push({ property: map.HIDE,     checkbox:{ equals:false }});

  // Published Only
  if (q.status !== 'all' && map.STATUS){
    and.push({
      or: [
        { property: map.STATUS, status:{ equals:'Publicado'} },
        { property: map.STATUS, status:{ equals:'Entregado'} },
        { property: map.STATUS, status:{ equals:'Scheduled'} },
        { property: map.STATUS, status:{ equals:'Aprobado'} },
      ]
    });
  }

  // Platforms (multi-select contains)
  if (q.platform && map.PLATFORM){
    and.push({ property: map.PLATFORM, multi_select:{ contains:q.platform }});
  }

  // Relations legibles via rollups (si existen)
  if (q.client && map.CLIENT_ROLL){
    and.push({ property: map.CLIENT_ROLL, rich_text:{ equals:q.client }});
  }
  if (q.project && map.PROJECT_ROLL){
    and.push({ property: map.PROJECT_ROLL, rich_text:{ equals:q.project }});
  }
  if (q.brand && map.BRAND_ROLL){
    and.push({ property: map.BRAND_ROLL, rich_text:{ equals:q.brand }});
  }

  // Search por título
  if (q.q && map.NAME){
    and.push({ property: map.NAME, title:{ contains:q.q }});
  }

  return and.length ? { and } : undefined;
}

/* ---------- filtros para meta (clientes/proyectos/platforms) ---------- */
function collectFiltersFromPosts(posts){
  const clients =[...new Set(posts.map(p=>p.client).filter(Boolean))].sort();
  const projects=[...new Set(posts.map(p=>p.project).filter(Boolean))].sort();
  const platforms=[...new Set(posts.flatMap(p=>p.platforms||[]))].sort();
  return { clients, projects, platforms };
}

/* ---------- handler ---------- */
export default async function handler(req, res){
  try{
    // parse query
    const url = new URL(req.url, 'http://x');
    const q = {
      meta: url.searchParams.get('meta'),
      limit: Math.min(parseInt(url.searchParams.get('limit')||'12',10), 100),
      page:  Math.max(parseInt(url.searchParams.get('page')||'0',10), 0),
      status: (url.searchParams.get('status')||'published'),
      client: url.searchParams.get('client')||'',
      project:url.searchParams.get('project')||'',
      brand:  url.searchParams.get('brand')||'',
      platform:url.searchParams.get('platform')||'',
      q:      url.searchParams.get('q')||''
    };

    // 1) leer schema
    const schema = await getSchema();

    // 2) resolver nombres reales presentes
    const map = Object.fromEntries(Object.entries(NAMES).map(([k,aliases])=>{
      return [k, pickName(schema, aliases)];
    }));

    // meta rápido
    if (q.meta){
      // leer últimos 100 y derivar listas
      const metaBody = { page_size: 100, sorts:[{ property: map.DATE || 'Last edited time', direction:'descending'}] };
      const mr = await fetch(`${NOTION_API}/databases/${process.env.NOTION_DATABASE_ID}/query`,{
        method:'POST',
        headers:{
          'Authorization':`Bearer ${process.env.NOTION_TOKEN}`,
          'Notion-Version':NOTION_VERSION,
          'Content-Type':'application/json'
        },
        body: JSON.stringify(metaBody)
      });
      if (!mr.ok){ const d=await mr.json().catch(()=>({})); return res.status(500).json({error:'meta query failed', detail:d}); }
      const mj = await mr.json();
      const posts = (mj.results||[]).map(p=>processPost(p, map));
      return res.status(200).json({ filters: collectFiltersFromPosts(posts) });
    }

    // 3) query segura con filtros existentes
    const body = {
      filter: buildFilters(map, q),
      sorts:  [
        ...(map.DATE ? [{ property: map.DATE, direction:'descending' }] : []),
        { timestamp:'last_edited_time', direction:'descending' }
      ],
      page_size: q.limit
    };

    const r = await fetch(`${NOTION_API}/databases/${process.env.NOTION_DATABASE_ID}/query`,{
      method:'POST',
      headers:{
        'Authorization':`Bearer ${process.env.NOTION_TOKEN}`,
        'Notion-Version':NOTION_VERSION,
        'Content-Type':'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!r.ok){
      const err = await r.json().catch(()=>({}));
      return res.status(500).json({ error:'Notion query failed', detail: err });
    }

    const json = await r.json();
    const posts = (json.results||[]).map(p=>processPost(p, map))
      .filter(p=>!p.archived && !p.hidden);

    return res.status(200).json({
      posts,
      has_more: !!json.has_more,
      next_cursor: json.next_cursor||null
    });

  }catch(e){
    res.status(500).json({ error:e.message });
  }
}
