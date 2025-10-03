// /api/health.js
module.exports = async (_req, res) => {
  res.status(200).json({
    ok: true,
    hasToken: !!process.env.NOTION_TOKEN,
    hasDb: !!process.env.NOTION_DATABASE_ID,
  });
};
