const fs = require('node:fs/promises');
const path = require('node:path');
const fontkit = require('@pdf-lib/fontkit');
const { rgb, degrees } = require('pdf-lib');
const { ToolError } = require('../errors');

const FONT_PATH = path.join(__dirname, '../../renderer/fonts/BeVietnamPro-Regular.ttf');
const fontSources = new WeakMap();

async function loadStampFont(doc) {
  const bytes = await fs.readFile(FONT_PATH);
  const source = fontkit.create(bytes);
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(bytes, { subset: true });
  fontSources.set(font, { source, coverage: new Set(source.characterSet) });
  return font;
}

function colorToRgb(hex) {
  if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex) || hex.length !== 7) {
    throw new ToolError('INVALID_OPTIONS', 'Màu phải có dạng #rrggbb.');
  }
  return rgb(...[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255));
}

function normalizeStampText(text) {
  if (typeof text !== 'string' || /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(text)) {
    throw new ToolError('INVALID_OPTIONS', 'Nội dung phải là một dòng, không chứa ký tự điều khiển.');
  }
  return text.normalize('NFC');
}

function formatTemplate(text, { page, total, date }) {
  const values = { page, total, date };
  return normalizeStampText(text).replace(/\{(page|total|date)\}/g, (_, key) => String(values[key]));
}

function normalizeRotation(rotation) {
  const angle = ((rotation % 360) + 360) % 360;
  if (!Number.isFinite(rotation) || ![0, 90, 180, 270].includes(angle)) {
    throw new ToolError('INVALID_FILE', 'Trang có góc xoay không hợp lệ.');
  }
  return angle;
}

// PDF.js displays the intersection, not the unbounded CropBox.
function visiblePageBox(page) {
  const media = page.getMediaBox();
  const crop = page.getCropBox();
  const x = Math.max(media.x, crop.x);
  const y = Math.max(media.y, crop.y);
  const width = Math.min(media.x + media.width, crop.x + crop.width) - x;
  const height = Math.min(media.y + media.height, crop.y + crop.height) - y;
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    throw new ToolError('INVALID_FILE', 'Vùng hiển thị của trang không hợp lệ.');
  }
  return { x, y, width, height };
}

// Top-left visible-view coordinates -> unrotated PDF coordinates.
// Shared by text and subsequent image transformations; never changes page boxes.
function displayToPdf(box, rotation, dx, dy) {
  const { x, y, width: w, height: h } = box;
  switch (normalizeRotation(rotation)) {
    case 0: return [x + dx, y + h - dy];
    case 90: return [x + dy, y + dx];
    case 180: return [x + w - dx, y + dy];
    case 270: return [x + w - dy, y + h - dx];
  }
}

function textRotation(extraAngle = 0, pageRotation = 0) {
  if (!Number.isFinite(extraAngle)) throw new ToolError('INVALID_OPTIONS', 'Góc chữ không hợp lệ.');
  // Positive page rotation matches editor export; extra is counter-clockwise.
  return ((normalizeRotation(pageRotation) + extraAngle) % 360 + 360) % 360;
}

function measureStampText(font, text, size) {
  const { source, coverage } = fontSources.get(font);
  const missing = [...new Set([...text].filter(ch => !coverage.has(ch.codePointAt(0))))];
  if (missing.length) {
    // Only bounded Unicode identifiers, never arbitrary input/control characters.
    const sample = missing.slice(0, 8).map(ch => `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`).join(', ');
    throw new ToolError('MISSING_GLYPHS', `Phông chữ không hỗ trợ: ${sample}${missing.length > 8 ? '…' : ''}.`);
  }
  const scale = size / source.unitsPerEm;
  let advance = 0, left = 0, right = 0;
  let ascent = source.ascent, descent = source.descent;
  // pdf-lib emits glyph advance widths (not fontkit positioning offsets).
  for (const glyph of source.layout(text).glyphs) {
    const b = glyph.bbox;
    if ([b.minX, b.maxX, b.minY, b.maxY].every(Number.isFinite)) {
      left = Math.min(left, advance + b.minX);
      right = Math.max(right, advance + b.maxX);
      ascent = Math.max(ascent, b.maxY);
      descent = Math.min(descent, b.minY);
    }
    advance += glyph.advanceWidth;
  }
  right = Math.max(right, advance);
  return { left: left * scale, width: (right - left) * scale, ascent: ascent * scale, descent: descent * scale };
}

function drawDisplayText(page, font, text, { dx, dy, size, color, opacity = 1, extraAngle = 0 }) {
  const [x, y] = displayToPdf(visiblePageBox(page), page.getRotation().angle, dx, dy);
  page.drawText(normalizeStampText(text), {
    x, y, size, font, color: typeof color === 'string' ? colorToRgb(color) : color,
    opacity, rotate: degrees(textRotation(extraAngle, page.getRotation().angle)),
  });
}

module.exports = {
  loadStampFont, colorToRgb, normalizeStampText, formatTemplate, normalizeRotation,
  visiblePageBox, displayToPdf, textRotation, measureStampText, drawDisplayText,
};
