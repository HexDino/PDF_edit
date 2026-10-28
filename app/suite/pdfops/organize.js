const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument } = require('pdf-lib');
const { ToolError } = require('../errors');
const { moveAtomic, outputName, uniquePath } = require('../util/paths');

async function merge(ctx) {
  const { files, tempDir, signal } = ctx;
  if (files.length < 2) throw new ToolError('INVALID_FILE', 'Cần ít nhất 2 file PDF.');
  ctx.progress('processing', 0, 1, 'Đang ghép PDF…');
  const outDir = ctx.outputDir || path.dirname(files[0]);
  fs.mkdirSync(outDir, { recursive: true });
  const out = uniquePath(outDir, outputName(files[0], 'ghep'));
  const tmp = path.join(tempDir, 'merged.pdf');

  try {
    const args = ['--empty', '--pages', ...files.flatMap(f => [f, '1-z']), '--', tmp];
    await ctx.qpdf(args);
  } catch (e) {
    if (e.code === 'CANCELLED') throw e;
    const text = `${e.stderr || ''} ${e.message || ''}`;
    if (/password|encrypted/i.test(text)) {
      throw new ToolError('PASSWORD_REQUIRED', 'Một file PDF có mật khẩu. Hãy mở khoá trước.');
    }
    await mergeWithPdfLib(files, tmp, signal);
  }

  signal.throwIfAborted();
  moveAtomic(tmp, out);
  ctx.progress('done', 1, 1, 'Đã ghép xong');
  const doc = await PDFDocument.load(fs.readFileSync(out));
  return { outputs: [{ path: out }], errors: [], stats: { pages: doc.getPageCount() } };
}

async function mergeWithPdfLib(files, out, signal) {
  const doc = await PDFDocument.create();
  for (const f of files) {
    signal.throwIfAborted();
    let src;
    try {
      src = await PDFDocument.load(fs.readFileSync(f));
    } catch (e) {
      if (/encrypt/i.test(e.message)) {
        throw new ToolError('PASSWORD_REQUIRED', 'Một file PDF có mật khẩu. Hãy mở khoá trước.');
      }
      throw new ToolError('CORRUPT_FILE', `Không đọc được ${path.basename(f)}.`);
    }
    const pages = await doc.copyPages(src, src.getPageIndices());
    pages.forEach(p => doc.addPage(p));
  }
  fs.writeFileSync(out, await doc.save());
}

module.exports = { merge };
