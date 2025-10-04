// ⬇️ Pega esto cerca de los helpers (pickTitle, pickImage, etc.)
function isHidden(page) {
  const p = page?.properties || {};
  return !!(
    p.Hidden?.checkbox ||
    p.Hide?.checkbox ||
    p["Hide from Grid"]?.checkbox ||
    (p.Status?.status?.name === "Hidden")
  );
}
