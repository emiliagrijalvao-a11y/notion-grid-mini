export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: {
      hasNotionToken: !!process.env.NOTION_TOKEN,
      hasNotionDbId: !!process.env.NOTION_DATABASE_ID,
      hasClientsDbId: !!process.env.NOTION_CLIENTS_DB_ID,
      hasProjectsDbId: !!process.env.NOTION_PROJECTS_DB_ID,
      hasBrandsDbId: !!process.env.NOTION_BRANDS_DB_ID
    }
  };

  return res.status(200).json(health);
}
