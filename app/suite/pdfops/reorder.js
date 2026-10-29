const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument, degrees } = require('pdf-lib');
const { ToolError } = require('../errors');
const { parsePageRange } = require('../pages');
const { outputName, publishUnique } = require('../util/paths');

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

function rotateValue(value) {
  const n = Number(value ?? 0);
  if (!ROTATIONS.has(n)) throw new ToolError('INVALID_OPTIONS', 'Góc xoay không hợp lệ.');
  return n;
}

function blankCountValue(value) {
  const n = Number(value ?? 0);
  if (!Number.isInteger(n) || n < 0 || n > 50) {
    throw new ToolError('INVALID_OPTIONS', 'Số trang trắng thêm vào không hợp lệ.');
  }
  return n;
}

async function organizeTool(ctx) {
  const file = ctx.files[0];
  ctx.signal.throwIfAborted();
  const doc = await loadPdf(file);
  ctx.signal.throwIfAborted();

  const pageCount = doc.getPageCount();
  // parsePageRange giữ nguyên thứ tự và trang lặp; rỗng = tất cả trang.
  const order = parsePageRange(ctx.options?.order, pageCount);
  const rotate = rotateValue(ctx.options?.rotate);
  const blankCount = blankCountValue(ctx.options?.blankCount);

  ctx.progress('processing', 0, 1, 'Đang tổ chức trang…');
  const outDoc = await PDFDocument.create();
  const copied = await outDoc.copyPages(doc, order.map(page => page - 1));
  for (const page of copied) {
    // Cộng góc xoay thay vì ghi đè để không làm mất hướng xoay sẵn có.
    page.setRotation(degrees(page.getRotation().angle + rotate));
    outDoc.addPage(page);
  }
  ctx.signal.throwIfAborted();

  if (blankCount > 0) {
    // Trang trắng dùng đúng khổ của trang cuối và cùng hướng hiển thị.
    const last = outDoc.getPage(outDoc.getPageCount() - 1);
    const width = last.getWidth();
    const height = last.getHeight();
    const lastRotation = last.getRotation();
    for (let i = 0; i < blankCount; i++) {
      outDoc.addPage([width, height]).setRotation(lastRotation);
    }
  }
  ctx.signal.throwIfAborted();

  const tmp = path.join(ctx.tempDir, 'organize.pdf');
  fs.writeFileSync(tmp, await outDoc.save());
  ctx.signal.throwIfAborted();

  const outDir = ctx.outputDir || path.dirname(file);
  const out = publishUnique(tmp, outDir, outputName(file, 'to-chuc'));
  ctx.progress('done', 1, 1, 'Đã tổ chức xong');
  return {
    outputs: [{ path: out }],
    errors: [],
    stats: { pages: outDoc.getPageCount(), blanks: blankCount },
  };
}

module.exports = { organizeTool };
