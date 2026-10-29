// Giới hạn cạnh dài ảnh render theo spec: tối đa 10.000 px.
export const MAX_RENDER_EDGE = 10000;

/**
 * Tỉ lệ render từ DPI, tự hạ khi cạnh dài vượt 10.000 px.
 * width/height là kích thước trang ở scale 1 (đã tính rotation).
 */
export function renderScale(dpi, width, height) {
  const base = Number(dpi) > 0 ? Number(dpi) / 72 : 1;
  const longest = Math.max(Number(width) || 0, Number(height) || 0);
  if (!(longest > 0)) return base;
  return Math.min(base, MAX_RENDER_EDGE / longest);
}
