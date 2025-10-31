const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

export default async function handler(req,res){
  try{
    const r = await fetch(`${NOTION_API}/databases/${process.env.NOTION_DATABASE_ID}`,{
      headers:{
        'Authorization':`Bearer ${process.env.NOTION_TOKEN}`,
        'Notion-Version':NOTION_VERSION
      }
    });
    const j = await r.json();
    const props = j.properties || {};
    const map = Object.fromEntries(Object.entries(props).map(([k,v])=>[k, v.type]));
    res.status(200).json({ id:j.id, title:j.title, properties: map });
  }catch(e){
    res.status(500).json({ error:e.message });
  }
}
