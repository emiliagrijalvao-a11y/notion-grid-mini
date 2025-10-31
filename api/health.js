// /api/health.js
export default function handler(req, res) {
  res.status(200).json({
    ok: true,
    hasToken: !!process.env.NOTION_TOKEN,
    hasDb: !!process.env.NOTION_DATABASE_ID,
    hasBioDb: !!process.env.BIO_DATABASE_ID,
    now: new Date().toISOString(),
  });
}
