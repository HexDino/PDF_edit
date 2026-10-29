const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument, degrees } = require('pdf-lib');
const { ToolError, toPayload } = require('../errors');
const { validateOptions } = require('../schema');
const { parsePageRange } = require('../pages');
const { outputName, publishUnique } = require('../util/paths');
const {
  loadStampFont, colorToRgb, normalizeStampText, normalizeRotation,
  visiblePageBox, displayToPdf, textRotation, measureStampText, drawDisplayText,
} = require('./stamp-common');

// One definition for both the registry/IPC and direct runner validation.
const watermarkOptions = [
  { key: 'kind', type: 'enum', values: ['text', 'image'], labels: { text: 'Chữ', image: 'Ảnh' }, default: 'text', label: 'Kiểu watermark' },
  { key: 'text', type: 'text', default: 'BẢN NHÁP', label: 'Nội dung chữ' },
  { key: 'imagePath', type: 'imageFile', accept: ['.png', '.jpg', '.jpeg'], default: '', label: 'Ảnh watermark', hint: 'PNG hoặc JPG, chọn từ máy.' },
  { key: 'fontSize', type: 'int', min: 12, max: 200, default: 60, label: 'Cỡ chữ (pt)' },
  { key: 'color', type: 'color', default: '#c81e1e', label: 'Màu chữ' },
  { key: 'opacity', type: 'int', min: 0, max: 100, default: 20, label: 'Độ mờ (%)' },
  { key: 'angle', type: 'int', min: -180, max: 180, default: 45, label: 'Góc xoay (°)', hint: 'Góc nhìn trên trang đã xoay.' },
  { key: 'tile', type: 'bool', default: false, label: 'Lặp kín trang', hint: 'Bật' },
  { key: 'margin', type: 'int', min: 0, max: 100, default: 0, label: 'Lề (mm)', hint: 'Chỉ áp dụng khi lặp kín trang.' },
  { key: 'pages', type: 'range', default: '', label: 'Khoảng trang', placeholder: '1-3,5 (trống = tất cả)' },
];
const TILE_GAP = 12;
const MAX_DRAWS_PER_PAGE = 200;
const yieldToEvents = () => new Promise(resolve => setImmediate(resolve));

function optionsFor(input = {}) {
  let options;
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error();
    options = validateOptions({ options: watermarkOptions }, input);
  } catch {
    // The shared validator's unknown-key message can contain untrusted text.
    throw new ToolError('INVALID_OPTIONS', 'Tuỳ chọn watermark không hợp lệ.');
  }
  if (options.kind === 'text') {
    options.text = normalizeStampText(options.text).trim();
    if (!options.text) throw new ToolError('INVALID_OPTIONS', 'Nhập nội dung watermark.');
  } else {
    if (!options.imagePath) throw new ToolError('INVALID_OPTIONS', 'Chọn ảnh watermark.');
    const ext = path.extname(options.imagePath).toLowerCase();
    if (!['.png', '.jpg', '.jpeg'].includes(ext)) {
      throw new ToolError('INVALID_OPTIONS', 'Ảnh watermark phải là PNG hoặc JPG.');
    }
  }
  return options;
}

async function readPdf(file) {
  // Keep filesystem errors separate for safe DISK/PERMISSION mapping.
  const bytes = fs.readFileSync(file);
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    doc.getPages();
    return doc;
  } catch (e) {
    if (/encrypt/i.test(e.message)) throw new ToolError('PASSWORD_REQUIRED', 'PDF có mật khẩu. Hãy mở khoá trước.');
    throw new ToolError('INVALID_FILE', 'Không đọc được PDF.');
  }
}

async function embedWatermarkImage(doc, file) {
  let bytes;
  try {
    bytes = fs.readFileSync(file);
  } catch {
    throw new ToolError('INVALID_FILE', 'Không đọc được ảnh watermark.');
  }
  try {
    return path.extname(file).toLowerCase() === '.png'
      ? await doc.embedPng(bytes)
      : await doc.embedJpg(bytes);
  } catch {
    throw new ToolError('INVALID_FILE', 'Ảnh watermark không hợp lệ.');
  }
}

function rotatedBounds(width, height, angle) {
  const rad = Math.abs(angle) * Math.PI / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  return { width: width * cos + height * sin, height: width * sin + height * cos };
}
// Fit unrotated points to the display rectangle, accounting for the visual
// rotation, and never upscale above the image's natural 72-DPI size.
function fitScale(width, height, availableWidth, availableHeight, angle) {
  const bounds = rotatedBounds(width, height, angle);
  return Math.min(1, availableWidth / bounds.width, availableHeight / bounds.height);
}
// Deterministic rectangular grid; the step (rotated bounds + gap) is enlarged
// until at most MAX_DRAWS_PER_PAGE cells remain.
function tiledCenters(availableWidth, availableHeight, boxWidth, boxHeight) {
  if (!(availableWidth > 0) || !(availableHeight > 0)) return null;
  if (!(boxWidth > 0) || !(boxHeight > 0)) return null;
  if (boxWidth > availableWidth + 1e-6 || boxHeight > availableHeight + 1e-6) return null;
  const baseX = boxWidth + TILE_GAP;
  const baseY = boxHeight + TILE_GAP;
  const countAt = (stepX, stepY) =>
    (Math.floor((availableWidth - boxWidth) / stepX + 1e-9) + 1)
    * (Math.floor((availableHeight - boxHeight) / stepY + 1e-9) + 1);
  let factor = Math.max(1, Math.sqrt(countAt(baseX, baseY) / MAX_DRAWS_PER_PAGE));
  let guard = 0;
  while (countAt(baseX * factor, baseY * factor) > MAX_DRAWS_PER_PAGE && guard++ < 10000) factor *= 1.01;
  const stepX = baseX * factor;
  const stepY = baseY * factor;
  const cols = Math.floor((availableWidth - boxWidth) / stepX + 1e-9) + 1;
  const rows = Math.floor((availableHeight - boxHeight) / stepY + 1e-9) + 1;
  if (!(cols > 0) || !(rows > 0) || cols * rows > MAX_DRAWS_PER_PAGE) return null;
  // Center the whole lattice in the inset area.
  const startX = (availableWidth - ((cols - 1) * stepX + boxWidth)) / 2 + boxWidth / 2;
  const startY = (availableHeight - ((rows - 1) * stepY + boxHeight)) / 2 + boxHeight / 2;
  const centers = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) centers.push([startX + col * stepX, startY + row * stepY]);
  }
  return centers;
}

function drawCenteredText(page, font, text, metrics, { cx, cy, size, color, opacity, angle }) {
  // Rotate the ink-box centre offset (not the baseline) onto the target centre.
  const rad = angle * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const centerU = metrics.left + metrics.width / 2;
  const centerV = (metrics.ascent + metrics.descent) / 2;
  const dx = cx - centerU * cos + centerV * sin;
  const dy = cy + centerU * sin + centerV * cos;
  drawDisplayText(page, font, text, { dx, dy, size, color, opacity, extraAngle: angle });
}

// pdf-lib rotates an image around its bottom-left anchor; place that anchor so
// the image's centre lands on (cx, cy) in display space.
function drawCenteredImage(page, image, { cx, cy, width, height, angle, opacity }) {
  const box = visiblePageBox(page);
  const pageRotation = normalizeRotation(page.getRotation().angle);
  const [px, py] = displayToPdf(box, pageRotation, cx, cy);
  const rotation = textRotation(angle, pageRotation);
  const rad = rotation * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  page.drawImage(image, {
    x: px - (width / 2) * cos + (height / 2) * sin,
    y: py - (width / 2) * sin - (height / 2) * cos,
    width, height, rotate: degrees(rotation), opacity,
  });
}

async function watermarkTool(ctx) {
  let tmp;
  try {
    ctx.signal.throwIfAborted();
    const options = optionsFor(ctx.options);
    if (!Array.isArray(ctx.files) || ctx.files.length !== 1 || typeof ctx.files[0] !== 'string') {
      throw new ToolError('INVALID_FILE', 'Chọn một file PDF.');
    }
    const file = ctx.files[0];
    const doc = await readPdf(file);
    ctx.signal.throwIfAborted();
    let selected;
    try {
      selected = [...new Set(parsePageRange(options.pages, doc.getPageCount()))].sort((a, b) => a - b);
    } catch {
      throw new ToolError('INVALID_RANGE', 'Khoảng trang không hợp lệ.');
    }
    const opacity = options.opacity / 100;
    const margin = options.margin * 72 / 25.4;
    let font = null;
    let color = null;
    let textMetrics = null;
    let image = null;
    let natural = null;
    if (options.kind === 'text') {
      font = await loadStampFont(doc);
      color = colorToRgb(options.color);
      // Also verifies real glyph coverage before any page is touched.
      textMetrics = measureStampText(font, options.text, options.fontSize);
    } else {
      image = await embedWatermarkImage(doc, options.imagePath);
      const size = image.size();
      natural = { width: size.width, height: size.height };
    }
    const invalidLayout = () => new ToolError('INVALID_OPTIONS', 'Watermark hoặc lề không vừa trang. Hãy giảm cỡ chữ, lề hoặc nội dung.');
    let draws = 0;
    ctx.progress('processing', 0, selected.length, 'Đang đóng watermark…');
    for (const [index, pageNumber] of selected.entries()) {
      ctx.signal.throwIfAborted();
      const page = doc.getPage(pageNumber - 1);
      const box = visiblePageBox(page);
      const pageRotation = normalizeRotation(page.getRotation().angle);
      const displayWidth = pageRotation % 180 ? box.height : box.width;
      const displayHeight = pageRotation % 180 ? box.width : box.height;
      let cell = null;
      if (options.kind === 'text') {
        cell = { width: textMetrics.width, height: textMetrics.ascent - textMetrics.descent };
      } else {
        const availableWidth = options.tile ? displayWidth - 2 * margin : displayWidth;
        const availableHeight = options.tile ? displayHeight - 2 * margin : displayHeight;
        if (!(availableWidth > 0) || !(availableHeight > 0)) throw invalidLayout();
        const scale = fitScale(natural.width, natural.height, availableWidth, availableHeight, options.angle);
        cell = { width: natural.width * scale, height: natural.height * scale };
      }
      if (!(cell.width > 0) || !(cell.height > 0)) throw invalidLayout();
      if (options.tile) {
        const availableWidth = displayWidth - 2 * margin;
        const availableHeight = displayHeight - 2 * margin;
        const bounds = rotatedBounds(cell.width, cell.height, options.angle);
        const centers = tiledCenters(availableWidth, availableHeight, bounds.width, bounds.height);
        if (!centers) throw invalidLayout();
        for (const [x, y] of centers) {
          const cx = margin + x;
          const cy = margin + y;
          if (options.kind === 'text') {
            drawCenteredText(page, font, options.text, textMetrics, {
              cx, cy, size: options.fontSize, color, opacity, angle: options.angle,
            });
          } else {
            drawCenteredImage(page, image, {
              cx, cy, width: cell.width, height: cell.height, angle: options.angle, opacity,
            });
          }
        }
        draws += centers.length;
      } else if (options.kind === 'text') {
        drawCenteredText(page, font, options.text, textMetrics, {
          cx: displayWidth / 2, cy: displayHeight / 2,
          size: options.fontSize, color, opacity, angle: options.angle,
        });
        draws += 1;
      } else {
        drawCenteredImage(page, image, {
          cx: displayWidth / 2, cy: displayHeight / 2,
          width: cell.width, height: cell.height, angle: options.angle, opacity,
        });
        draws += 1;
      }
      ctx.progress('processing', index + 1, selected.length, `Đã đóng watermark ${index + 1}/${selected.length} trang`);
      // A microtask alone cannot deliver Electron's cancel IPC.
      await yieldToEvents();
      ctx.signal.throwIfAborted();
    }
    const bytes = await doc.save();
    await yieldToEvents();
    ctx.signal.throwIfAborted();
    tmp = path.join(ctx.tempDir, 'watermark.pdf');
    fs.writeFileSync(tmp, bytes);
    ctx.signal.throwIfAborted();
    const out = publishUnique(tmp, ctx.outputDir || path.dirname(file), outputName(file, 'watermark'));
    ctx.progress('done', selected.length, selected.length, 'Đã tạo watermark');
    return { outputs: [{ path: out }], errors: [], stats: { pages: selected.length, draws } };
  } catch (e) {
    if (ctx.signal.aborted) throw e;
    const safe = toPayload(e);
    throw new ToolError(safe.code, safe.message);
  } finally {
    if (tmp) { try { fs.unlinkSync(tmp); } catch { /* published or job cleanup owns it */ } }
  }
}

module.exports = { watermarkTool, watermarkOptions };
