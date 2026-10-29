const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument } = require('pdf-lib');
const { ToolError } = require('../errors');
const { parsePageRange } = require('../pages');
const { splitExt, uniqueDir } = require('../util/paths');

// Kiểm tra worker trả đủ trang đã yêu cầu trước khi tạo thư mục đích; nhờ vậy
// job lỗi/thiếu trang không để lại thư mục rỗng hay ảnh dở dang.
function assertRendered(rendered, pages) {
  if (!Array.isArray(rendered) || rendered.length !== pages.length) {
    throw new ToolError('RENDER_FAILED', 'Không render được trang PDF.');
  }
  const expected = new Set(pages);
  const seen = new Set();
  for (const item of rendered) {
    if (!item || !expected.has(item.page) || typeof item.path !== 'string' || !item.path) {
      throw new ToolError('RENDER_FAILED', 'Không render được trang PDF.');
    }
    seen.add(item.page);
  }
  if (seen.size !== expected.size) throw new ToolError('RENDER_FAILED', 'Không render được trang PDF.');
}

async function pdfImages(ctx) {
  const file = ctx.files[0];
  let doc;
  try { doc = await PDFDocument.load(fs.readFileSync(file)); }
  catch (e) {
    if (/encrypt/i.test(e.message)) throw new ToolError('PASSWORD_REQUIRED', 'PDF có mật khẩu. Hãy mở khoá trước.');
    throw new ToolError('INVALID_FILE', 'Không đọc được PDF.');
  }
  const pageCount = doc.getPageCount();
  const pages = parsePageRange(ctx.options.pages, pageCount);
  ctx.signal.throwIfAborted();
  const format = ctx.options.format === 'png' ? 'png' : 'jpg';
  const root = ctx.outputDir || path.dirname(file);
  const base = splitExt(file).base;

  const rendered = await ctx.render.pdfToImages({
    filePath: file, pages, dpi: ctx.options.dpi, format,
    quality: ctx.options.quality / 100, outDir: ctx.tempDir,
    signal: ctx.signal,
    progress: (done, total) => ctx.progress('processing', done, total, `Đang xuất trang ${done}/${total}…`),
  });
  ctx.signal.throwIfAborted();
  assertRendered(rendered, pages);

  fs.mkdirSync(root, { recursive: true });
  const folder = uniqueDir(root, `${base}-anh`);
  fs.mkdirSync(folder);
  const outputs = [];
  try {
    for (const item of rendered) {
      ctx.signal.throwIfAborted();
      const dest = path.join(folder, `${base}-${String(item.page).padStart(2, '0')}.${format}`);
      fs.copyFileSync(item.path, dest);
      outputs.push({ path: dest });
    }
  } catch (e) {
    // Thư mục vừa tạo bằng tên độc quyền nên có thể xoá sạch khi copy lỗi.
    try { fs.rmSync(folder, { recursive: true, force: true }); } catch { /* dọn dẹp nỗ lực cuối */ }
    throw e;
  }
  return { outputs, errors: [], stats: { pages: outputs.length } };
}

module.exports = { pdfImages };
