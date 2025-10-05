// /api/health.js
export default async function handler(req, res) {
  const payload = {
    ok: true,
    env: {
      NOTION_TOKEN: !!process.env.NOTION_TOKEN,
      NOTION_DATABASE_ID: !!process.env.NOTION_DATABASE_ID,
      BIO_DATABASE_ID: !!process.env.BIO_DATABASE_ID,
    },
    now: new Date().toISOString(),
  };

  // Si corre en Node (req/res estilo Express)
  if (res && typeof res.status === "function") {
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(payload);
  }

  // Fallback para Edge / Fetch API
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
