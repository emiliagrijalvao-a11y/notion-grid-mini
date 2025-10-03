export default function handler(req, res) {
  res.status(200).json({
    ok: true,
    now: new Date().toISOString(),
    hasToken: !!process.env.NOTION_TOKEN,
    hasDb: !!process.env.NOTION_DATABASE_ID,
    // opcionales para el Bio (si no están, simplemente no se muestran)
    bioName: process.env.BIO_NAME || "",
    bioText: process.env.BIO_TEXT || "",
    bioUrl: process.env.BIO_URL || "",
    bioAvatar: process.env.BIO_AVATAR || ""
  });
}
