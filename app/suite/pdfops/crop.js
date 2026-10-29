const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument } = require('pdf-lib');
const { ToolError } = require('../errors');
const { parsePageRange } = require('../pages');
const { outputName, publishUnique } = require('../util/paths');

const MM_TO_PT = 72 / 25.4;
const ROTATIONS = new Set([0, 90, 180, 270]);

async function loadPdf(file) {
  try {
    const doc = await PDFDocument.load(fs.readFileSync(file));
    // pdf-lib đọc lười trang; gọi sớm để PDF hỏng bị bắt ngay tại đây.
    doc.getPageCount();
    return doc;
  } catch (e) {
    if (/encrypt/i.test(e.message)) {
      throw new ToolError('PASSWORD_REQUIRED', 'PDF có mật khẩu. Hãy mở khoá trước.');
    }
    throw new ToolError('INVALID_FILE', 'Không đọc được PDF.');
  }
}

function marginValue(value) {
  const n = Number(value ?? 0);
  if (!Number.isInteger(n) || n < 0 || n > 200) {
    throw new ToolError('INVALID_OPTIONS', 'Lề cắt phải là số mm từ 0 đến 200.');
  }
  return n * MM_TO_PT;
}

// Trả hộp cắt trong toạ độ PDF chưa xoay. Lề người dùng nhập theo hướng
// hiển thị nên với trang xoay phải hoán đổi trái/phải/trên/dưới tương ứng.
function cropBoxFor(page, box, margins, pageNumber) {
  const { top, right, bottom, left } = margins;
  const angle = ((page.getRotation().angle % 360) + 360) % 360;
  if (!ROTATIONS.has(angle)) {
    throw new ToolError('INVALID_FILE', 'Trang có góc xoay không hợp lệ.');
  }
  let x;
  let y;
  let width;
  let height;
  switch (angle) {
    case 0:
      x = box.x + left;
      y = box.y + bottom;
      width = box.width - left - right;
      height = box.height - bottom - top;
      break;
    case 90:
      x = box.x + top;
      y = box.y + left;
      width = box.width - top - bottom;
      height = box.height - left - right;
      break;
    case 180:
      x = box.x + right;
      y = box.y + top;
      width = box.width - right - left;
      height = box.height - top - bottom;
      break;
    default: // 270
      x = box.x + bottom;
      y = box.y + right;
      width = box.width - bottom - top;
      height = box.height - right - left;
      break;
  }
  if (width < 1 || height < 1) {
    throw new ToolError('INVALID_OPTIONS', `Lề cắt quá lớn cho trang ${pageNumber}.`);
  }
  return { x, y, width, height };
}

async function cropTool(ctx) {
  const file = ctx.files[0];
  ctx.signal.throwIfAborted();
  const doc = await loadPdf(file);
  ctx.signal.throwIfAborted();

  const pageCount = doc.getPageCount();
  const selected = new Set(parsePageRange(ctx.options?.pages, pageCount));
  const margins = {
    top: marginValue(ctx.options?.top),
    right: marginValue(ctx.options?.right),
    bottom: marginValue(ctx.options?.bottom),
    left: marginValue(ctx.options?.left),
  };

  ctx.progress('processing', 0, 1, 'Đang cắt lề…');
  for (let i = 0; i < pageCount; i++) {
    if (!selected.has(i + 1)) continue;
    const page = doc.getPage(i);
    const crop = cropBoxFor(page, page.getMediaBox(), margins, i + 1);
    // Chỉ đặt CropBox; MediaBox và góc xoay của trang giữ nguyên.
    page.setCropBox(crop.x, crop.y, crop.width, crop.height);
  }
  ctx.signal.throwIfAborted();

  const tmp = path.join(ctx.tempDir, 'crop.pdf');
  fs.writeFileSync(tmp, await doc.save());
  ctx.signal.throwIfAborted();

  const outDir = ctx.outputDir || path.dirname(file);
  const out = publishUnique(tmp, outDir, outputName(file, 'crop'));
  ctx.progress('done', 1, 1, 'Đã cắt xong');
  return { outputs: [{ path: out }], errors: [], stats: { pages: selected.size } };
}

module.exports = { cropTool };
