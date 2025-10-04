export default function handler(req, res) {
  res.status(200).json({
    ok: true,
    now: new Date().toISOString(),
    // Notion
    hasToken: !!process.env.NOTION_TOKEN,
    hasDb: !!process.env.NOTION_DATABASE_ID,
    // Bio (personalizable por ENV en Vercel)
    bioUsername: process.env.BIO_USERNAME || "",
    bioName: process.env.BIO_NAME || "",
    bioText: process.env.BIO_TEXT || "",
    bioUrl: process.env.BIO_URL || "",
    bioAvatar: process.env.BIO_AVATAR || ""
  });
}
