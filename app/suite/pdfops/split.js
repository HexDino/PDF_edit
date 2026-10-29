const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument } = require('pdf-lib');
const { ToolError } = require('../errors');
const { parsePageSegments } = require('../pages');
const { splitExt, uniqueDir } = require('../util/paths');

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

function segmentsFor(ctx, pageCount) {
  const mode = ctx.options?.mode || 'ranges';
  if (mode === 'each-page') {
    return Array.from({ length: pageCount }, (_, i) => [i + 1]);
  }
  if (mode === 'every-n') {
    const every = Number(ctx.options?.every);
    if (!Number.isInteger(every) || every < 1 || every > 1000) {
      throw new ToolError('INVALID_OPTIONS', 'Số trang mỗi file không hợp lệ.');
    }
    const out = [];
    for (let start = 1; start <= pageCount; start += every) {
      const end = Math.min(start + every - 1, pageCount);
      out.push(Array.from({ length: end - start + 1 }, (_, i) => start + i));
    }
    return out;
  }
  return parsePageSegments(ctx.options?.ranges, pageCount);
}

async function splitPdf(ctx) {
  const file = ctx.files[0];
  ctx.signal.throwIfAborted();
  const doc = await loadPdf(file);
  ctx.signal.throwIfAborted();
  const pageCount = doc.getPageCount();
  const segments = segmentsFor(ctx, pageCount);
  ctx.signal.throwIfAborted();

  const root = ctx.outputDir || path.dirname(file);
  const base = splitExt(file).base;
  fs.mkdirSync(root, { recursive: true });
  const folder = uniqueDir(root, `${base}-tach`);
  fs.mkdirSync(folder);
  const outputs = [];
  try {
    ctx.progress('processing', 0, segments.length, 'Đang tách PDF…');
    for (const [index, pages] of segments.entries()) {
      ctx.signal.throwIfAborted();
      const outDoc = await PDFDocument.create();
      const copied = await outDoc.copyPages(doc, pages.map(p => p - 1));
      for (const page of copied) outDoc.addPage(page);
      ctx.signal.throwIfAborted();
      const name = `${base}-${String(index + 1).padStart(2, '0')}.pdf`;
      const dest = path.join(folder, name);
      // Thư mục vừa tạo độc quyền nên tên file luôn trống; cờ wx chỉ là chốt chặn.
      fs.writeFileSync(dest, await outDoc.save(), { flag: 'wx' });
      outputs.push({ path: dest });
      ctx.progress('processing', index + 1, segments.length, `Đang tách ${index + 1}/${segments.length}…`);
    }
    // Huỷ sau file cuối vẫn phải dọn thư mục, không để kết quả dở dang.
    ctx.signal.throwIfAborted();
  } catch (e) {
    try { fs.rmSync(folder, { recursive: true, force: true }); } catch { /* dọn dẹp nỗ lực cuối */ }
    throw e;
  }
  ctx.progress('done', segments.length, segments.length, 'Đã tách xong');
  return { outputs, errors: [], stats: { pages: pageCount, files: outputs.length } };
}

module.exports = { splitPdf };
