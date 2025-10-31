const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

function pick(a, ...keys){ const o={}; keys.forEach(k=>o[k]=a[k]); return o; }
function isVideoName(name){ if(!name) return false; const s=name.toLowerCase(); return ['.mp4','.webm','.mov','.m4v','.avi','.mkv'].some(ext=>s.endsWith(ext)); }
function rollupText(p){ // acepta rollup o rich_text
  if (!p) return '';
  if (p.rollup && p.rollup.array && p.rollup.array[0]) {
    const a = p.rollup.array[0];
    if (a.title && a.title[0]) return a.title.map(t=>t.plain_text).join('');
    if (a.rich_text && a.rich_text[0]) return a.rich_text.map(t=>t.plain_text).join('');
    if (a.name) return a.name;
  }
  if (Array.isArray(p.rich_text)) return p.rich_text.map(t=>t.plain_text).join('');
  return '';
}
function titleText(p){ return Array.isArray(p?.title) ? p.title.map(t=>t.plain_text).join('') : ''; }
function dateValue(p){ return (p?.date?.start) || (p?.date?.start===null?null:undefined); }
function multiSelectNames(p){ return Array.isArray(p?.multi_select) ? p.multi_select.map(x=>x.name) : []; }

function extractAssets(props){
  // soporta Attachment / Files / Media + Links externos (Link, Canva)
  const out=[];
  const files = props.Attachment?.files || props.Files?.files || props.Media?.files || [];
  files.forEach(f=>{
    const url = f.type==='external' ? f.external.url : f.file.url;
    out.push({ url, type: isVideoName(f.name) ? 'video' : 'image', source:'attachment' });
  });
  // si no hay, pero hay Link/Canva
  if (!out.length){
    const link = props.Link?.url || props.Canva?.url;
    if (link) out.push({ url: link, type: isVideoName(link)?'video':'image', source:'link' });
  }
  return out;
}

// mapeo tolerante de nombres de propiedades
const P = {
  NAME:           ['Name','Post','Título','Title'],
  DATE:           ['Publish Date','Fecha'],
  STATUS:         ['Status','Estado'],
  PLATFORM:       ['Platform','Plataforma','Platforms'],
  TYPE:           ['Type','Tipo'],
  OWNER:          ['Owner','Propietario','Responsable'],

  // toggles
  HIDE:           ['Hide','Hidden','Oculto'],
  ARCHIVED:       ['Archivado','Archived'],

  // relations + rollups
  R_CLIENT_ROLL:  ['ClientName','Cliente','Client'],  // rollup legible
  R_PROJECT_ROLL: ['ProjectName','Proyecto','Project'],
  R_BRAND_ROLL:   ['BrandName','Marca','Brand'],

  COPY:           ['Copy','Caption','Texto'],
};

function readProp(obj, aliases){
  for (const k of aliases){ if (obj[k]!==undefined) return obj[k]; }
  return undefined;
}

function processPost(p){
  const props = p.properties || {};
  const title = titleText(readProp(props,P.NAME)) || 'Untitled';
  const date  = dateValue(readProp(props,P.DATE)) || '';
  const status= readProp(props,P.STATUS)?.status?.name || '';
  const type  = readProp(props,P.TYPE)?.select?.name || '';
  const platforms = multiSelectNames(readProp(props,P.PLATFORM));

  const client = rollupText(readProp(props,P.R_CLIENT_ROLL));
  const project= rollupText(readProp(props,P.R_PROJECT_ROLL));
  const brand  = rollupText(readProp(props,P.R_BRAND_ROLL));

  const owner  = readProp(props,P.OWNER)?.people?.[0]?.name || '';
  const owner_initials = owner ? owner.slice(0,2).toUpperCase() : '';
  // color simple determinista por hash
  const palette=['#10B981','#8B5CF6','#EC4899','#F59E0B','#3B82F6','#EF4444','#FCD34D','#14B8A6','#A855F7','#22C55E'];
  let hash=0; for (let i=0;i<owner.length;i++) hash=(hash*31+owner.charCodeAt(i))|0;
  const owner_color = owner ? palette[Math.abs(hash)%palette.length] : '';

  const archived = !!(readProp(props,P.ARCHIVED)?.checkbox);
  const hidden   = !!(readProp(props,P.HIDE)?.checkbox);

  const copyText = (readProp(props,P.COPY)?.rich_text||[]).map(t=>t.plain_text).join('');

  return {
    id:p.id, title, date, status, type, platforms, client, project, brand,
    owner, owner_initials, owner_color,
    archived, hidden,
    pinned: !!props.Pinned?.checkbox,
    copy: copyText,
    assets: extractAssets(props)
  };
}

function buildStatusFilter(q){
  // Published Only vs All
  if (q.status==='all') return null;
  // Published Only: Publicado, Entregado, Scheduled, Aprobado
  return {
    or: [
      { property:'Status', status:{ equals:'Publicado'} },
      { property:'Status', status:{ equals:'Entregado'} },
      { property:'Status', status:{ equals:'Scheduled'} },
      { property:'Status', status:{ equals:'Aprobado'} },
    ]
  };
}

function baseFilters(q){
  const arr = [
    { property: 'Archivado', checkbox:{ equals:false }},
    { property: 'Archived',  checkbox:{ equals:false }},
    { property: 'Hide',      checkbox:{ equals:false }},
    { property: 'Hidden',    checkbox:{ equals:false }},
  ];
  const st = buildStatusFilter(q);
  if (st) arr.push(st);

  // platform (multi-select contains)
  if (q.platform){
    arr.push({ property:'Platform', multi_select:{ contains:q.platform }});
  }
  // these use rollups legibles (ClientName/ProjectName/BrandName). Si no existen, el filtro no se aplica.
  if (q.client){
    arr.push({ property:'ClientName', rich_text:{ equals:q.client }});
  }
  if (q.project){
    arr.push({ property:'ProjectName', rich_text:{ equals:q.project }});
  }
  if (q.brand){
    arr.push({ property:'BrandName', rich_text:{ equals:q.brand }});
  }
  if (q.q){
    arr.push({ property:'Name', title:{ contains:q.q }});
  }
  return arr;
}

export default async function handler(req, res){
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

  try{
    if (q.meta){
      const filters = await collectFilters();
      return res.status(200).json({ filters });
    }

    const body = {
      filter: { and: baseFilters(q) },
      sorts:  [{ property:'Publish Date', direction:'descending' }, { property:'Fecha', direction:'descending' }],
      page_size: q.limit
      // start_cursor: could be wired later for deep pagination
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
    const posts = (json.results||[]).map(processPost).filter(p=>!p.archived && !p.hidden);

    return res.status(200).json({
      posts,
      has_more: !!json.has_more,
      next_cursor: json.next_cursor||null
    });
  }catch(e){
    return res.status(500).json({ error:e.message });
  }
}

// obtiene listas para selects (rápido). Si no tienes DBs separadas, se arma desde últimos 100.
async function collectFilters(){
  const r = await fetch(`${NOTION_API}/databases/${process.env.NOTION_DATABASE_ID}/query`,{
    method:'POST',
    headers:{
      'Authorization':`Bearer ${process.env.NOTION_TOKEN}`,
      'Notion-Version':NOTION_VERSION,
      'Content-Type':'application/json'
    },
    body: JSON.stringify({ page_size: 100, sorts:[{ property:'Publish Date', direction:'descending'}] })
  });
  const json = await r.json();
  const results = json.results||[];
  const posts = results.map(processPost);

  const clients   = [...new Set(posts.map(p=>p.client).filter(Boolean))].sort();
  const projects  = [...new Set(posts.map(p=>p.project).filter(Boolean))].sort();
  const platforms = [...new Set(posts.flatMap(p=>p.platforms||[]))].sort();

  return { clients, projects, platforms };
}
