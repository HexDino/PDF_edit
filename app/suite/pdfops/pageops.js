const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument } = require('pdf-lib');
const { ToolError } = require('../errors');
const { parsePageRange } = require('../pages');
const { outputName, publishUnique } = require('../util/paths');

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

async function pagesTool(ctx) {
  const file = ctx.files[0];
  ctx.signal.throwIfAborted();
  const doc = await loadPdf(file);
  ctx.signal.throwIfAborted();
  const pageCount = doc.getPageCount();
  const mode = ctx.options?.mode === 'delete' ? 'delete' : 'extract';
  const requested = parsePageRange(ctx.options?.pages, pageCount);
  ctx.signal.throwIfAborted();

  let keep;
  let suffix;
  if (mode === 'delete') {
    const drop = new Set(requested);
    if (drop.size >= pageCount) throw new ToolError('NO_PAGES', 'Không thể xoá tất cả trang.');
    keep = [];
    for (let page = 1; page <= pageCount; page++) {
      if (!drop.has(page)) keep.push(page);
    }
    suffix = 'xoa-trang';
  } else {
    // parsePageRange giữ nguyên thứ tự và trang lặp; rỗng = tất cả trang.
    keep = requested;
    suffix = 'trich-trang';
  }

  ctx.progress('processing', 0, 1, mode === 'delete' ? 'Đang xoá trang…' : 'Đang trích trang…');
  const outDoc = await PDFDocument.create();
  const copied = await outDoc.copyPages(doc, keep.map(p => p - 1));
  for (const page of copied) outDoc.addPage(page);
  ctx.signal.throwIfAborted();

  const tmp = path.join(ctx.tempDir, 'pages.pdf');
  fs.writeFileSync(tmp, await outDoc.save());
  ctx.signal.throwIfAborted();

  const outDir = ctx.outputDir || path.dirname(file);
  const out = publishUnique(tmp, outDir, outputName(file, suffix));
  ctx.progress('done', 1, 1, mode === 'delete' ? 'Đã xoá trang' : 'Đã trích trang');
  return { outputs: [{ path: out }], errors: [], stats: { pages: keep.length } };
}

module.exports = { pagesTool };
