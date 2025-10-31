const { Client } = require('@notionhq/client');

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const notion = new Client({
      auth: process.env.NOTION_TOKEN
    });

    const databaseId = process.env.NOTION_DATABASE_ID;

    // Obtener parámetros de filtro
    const { client, project, brand, platform, status, search } = req.query;

    // Construir filtros dinámicos
    let filters = [];

    // Filtro de status por defecto (Published Only)
    if (status !== 'all') {
      filters.push({
        property: 'Status',
        select: {
          equals: 'Published'
        }
      });
    }

    // Filtros por cliente, proyecto, etc.
    if (client && client !== 'all') {
      filters.push({
        property: 'Client',
        relation: {
          contains: client
        }
      });
    }

    if (project && project !== 'all') {
      filters.push({
        property: 'Project',
        relation: {
          contains: project
        }
      });
    }

    if (brand && brand !== 'all') {
      filters.push({
        property: 'Brand',
        relation: {
          contains: brand
        }
      });
    }

    if (platform && platform !== 'all') {
      filters.push({
        property: 'Platform',
        select: {
          equals: platform
        }
      });
    }

    // Búsqueda por texto
    if (search && search.trim() !== '') {
      filters.push({
        property: 'Name',
        title: {
          contains: search.trim()
        }
      });
    }

    // Query a Notion
    const queryConfig = {
      database_id: databaseId,
      sorts: [
        {
          property: 'Created',
          direction: 'descending'
        }
      ],
      page_size: 100
    };

    // Solo agregar filtros si existen
    if (filters.length > 0) {
      queryConfig.filter = filters.length === 1 
        ? filters[0] 
        : { and: filters };
    }

    const response = await notion.databases.query(queryConfig);

    return res.status(200).json({
      results: response.results,
      has_more: response.has_more,
      next_cursor: response.next_cursor
    });

  } catch (error) {
    console.error('Error en grid.js:', error);
    return res.status(500).json({ 
      error: 'Error cargando posts',
      details: error.message,
      code: error.code
    });
  }
}
