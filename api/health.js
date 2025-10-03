// API: /api/health
export default function handler(req, res) {
  res.status(200).json({
    ok: true,
    ts: new Date().toISOString(),
    message: "Widget funcionando"
  });
}
