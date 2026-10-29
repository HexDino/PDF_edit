const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument } = require('pdf-lib');
const { ToolError, toPayload } = require('../errors');
const { validateOptions } = require('../schema');
const { parsePageRange } = require('../pages');
const { outputName, publishUnique } = require('../util/paths');
const {
  loadStampFont, colorToRgb, normalizeStampText, formatTemplate, normalizeRotation,
  visiblePageBox, measureStampText, drawDisplayText,
} = require('./stamp-common');

// One definition for both the registry/IPC and direct runner validation.
const stampOptions = [
  { key: 'leftText', type: 'text', default: '', label: 'Nội dung trái' },
  { key: 'centerText', type: 'text', default: 'Trang {page}/{total}', label: 'Nội dung giữa', hint: '{page}: số liên tiếp trên các trang được chọn (theo thứ tự tài liệu); {total}: số cuối cùng; {date}: ngày dd/MM/yyyy. Bắt đầu từ số đã chọn.' },
  { key: 'rightText', type: 'text', default: '', label: 'Nội dung phải' },
  { key: 'fontSize', type: 'int', min: 6, max: 48, default: 10, label: 'Cỡ chữ (pt)' },
  { key: 'color', type: 'color', default: '#1f2937', label: 'Màu chữ' },
  { key: 'position', type: 'enum', values: ['footer', 'header'], labels: { footer: 'Chân trang', header: 'Đầu trang' }, default: 'footer', label: 'Vị trí' },
  { key: 'margin', type: 'int', min: 0, max: 100, default: 10, label: 'Lề (mm)' },
  { key: 'startAt', type: 'int', min: 1, max: 10000, default: 1, label: 'Bắt đầu từ số' },
  { key: 'pages', type: 'range', default: '', label: 'Khoảng trang', placeholder: '1-3,5 (trống = tất cả)' },
];
const yieldToEvents = () => new Promise(resolve => setImmediate(resolve));

function optionsFor(input = {}) {
  let options;
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error();
    options = validateOptions({ options: stampOptions }, input);
  } catch {
    // Shared validator's unknown-key message can contain untrusted text.
    throw new ToolError('INVALID_OPTIONS', 'Tuỳ chọn đánh số trang không hợp lệ.');
  }
  for (const key of ['leftText', 'centerText', 'rightText']) options[key] = normalizeStampText(options[key]);
  if (![options.leftText, options.centerText, options.rightText].some(s => s.trim())) {
    throw new ToolError('INVALID_OPTIONS', 'Nhập ít nhất một nội dung đầu hoặc chân trang.');
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

function layout(page, font, texts, options) {
  const box = visiblePageBox(page);
  const rotation = normalizeRotation(page.getRotation().angle);
  const [width, height] = rotation % 180 ? [box.height, box.width] : [box.width, box.height];
  const margin = options.margin * 72 / 25.4;
  const slots = texts.map((text, index) => text.trim() ? { text, index, ...measureStampText(font, text, options.fontSize) } : null).filter(Boolean);
  const ascent = Math.max(...slots.map(s => s.ascent));
  const descent = Math.min(...slots.map(s => s.descent));
  const invalid = () => new ToolError('INVALID_OPTIONS', 'Nội dung hoặc lề không vừa trang. Hãy giảm cỡ chữ, lề hoặc độ dài nội dung.');
  if (width <= 2 * margin || height < 2 * margin + ascent - descent) throw invalid();
  const dy = options.position === 'header' ? margin + ascent : height - margin + descent;
  for (const slot of slots) {
    if (slot.width > width - 2 * margin) throw invalid();
    slot.start = slot.index === 0 ? margin : slot.index === 1 ? (width - slot.width) / 2 : width - margin - slot.width;
    slot.dx = slot.start - slot.left;
    slot.dy = dy;
  }
  // Distinct slots must not silently paint over each other.
  for (let i = 1; i < slots.length; i++) {
    if (slots[i - 1].start + slots[i - 1].width > slots[i].start) throw invalid();
  }
  return slots;
}

async function stampTool(ctx) {
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
    const now = new Date();
    const date = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
    const total = options.startAt + selected.length - 1;
    const font = await loadStampFont(doc);
    const color = colorToRgb(options.color);
    ctx.progress('processing', 0, selected.length, 'Đang đánh số trang…');
    for (const [index, pageNumber] of selected.entries()) {
      ctx.signal.throwIfAborted();
      const page = doc.getPage(pageNumber - 1);
      const values = { page: options.startAt + index, total, date };
      const texts = [options.leftText, options.centerText, options.rightText].map(text => formatTemplate(text, values));
      for (const slot of layout(page, font, texts, options)) {
        drawDisplayText(page, font, slot.text, { dx: slot.dx, dy: slot.dy, size: options.fontSize, color });
      }
      ctx.progress('processing', index + 1, selected.length, `Đã đánh số ${index + 1}/${selected.length} trang`);
      // A microtask alone cannot deliver Electron's cancel IPC.
      await yieldToEvents();
      ctx.signal.throwIfAborted();
    }
    const bytes = await doc.save();
    await yieldToEvents();
    ctx.signal.throwIfAborted();
    tmp = path.join(ctx.tempDir, 'stamp.pdf');
    fs.writeFileSync(tmp, bytes);
    ctx.signal.throwIfAborted();
    const out = publishUnique(tmp, ctx.outputDir || path.dirname(file), outputName(file, 'so-trang'));
    ctx.progress('done', selected.length, selected.length, 'Đã đánh số xong');
    return { outputs: [{ path: out }], errors: [], stats: { pages: selected.length } };
  } catch (e) {
    if (ctx.signal.aborted) throw e;
    const safe = toPayload(e);
    throw new ToolError(safe.code, safe.message);
  } finally {
    if (tmp) { try { fs.unlinkSync(tmp); } catch { /* published or job cleanup owns it */ } }
  }
}

module.exports = { stampTool, stampOptions };
