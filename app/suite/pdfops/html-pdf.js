const fs = require('node:fs');
const path = require('node:path');
const { ToolError } = require('../errors');
const { splitExt, publishUnique } = require('../util/paths');

const PAGE_SIZES = new Set(['A4', 'A3', 'Letter']);
const HTML_EXTS = new Set(['.html', '.htm']);

function invalidHtml() {
  return new ToolError('INVALID_FILE', 'Không đọc được file HTML.');
}

function isAbort(error) {
  return error?.name === 'AbortError' || error?.code === 'CANCELLED';
}

function resolveOptions(options = {}) {
  const pageSize = options.pageSize ?? 'A4';
  if (!PAGE_SIZES.has(pageSize)) {
    throw new ToolError('INVALID_OPTIONS', 'Khổ giấy không hợp lệ.');
  }
  const landscape = options.landscape ?? false;
  const printBackground = options.printBackground ?? true;
  if (typeof landscape !== 'boolean' || typeof printBackground !== 'boolean') {
    throw new ToolError('INVALID_OPTIONS', 'Tuỳ chọn in không hợp lệ.');
  }
  const margin = options.margin ?? 10;
  if (!Number.isInteger(margin) || margin < 0 || margin > 50) {
    throw new ToolError('INVALID_OPTIONS', 'Lề không hợp lệ.');
  }
  return { pageSize, landscape, printBackground, margin };
}

async function htmlTool(ctx) {
  const files = Array.isArray(ctx.files) ? ctx.files : [];
  if (files.length !== 1) throw new ToolError('INVALID_FILE', 'Chọn một file HTML.');
  const file = files[0];
  if (typeof file !== 'string' || !HTML_EXTS.has(path.extname(file).toLowerCase())) {
    throw invalidHtml();
  }
  ctx.signal.throwIfAborted();

  const { pageSize, landscape, printBackground, margin } = resolveOptions(ctx.options);
  if (!ctx.printHtml || typeof ctx.printHtml !== 'function') {
    throw new ToolError('INTERNAL', 'Không in được HTML.');
  }

  ctx.progress('processing', 0, 1, 'Đang in HTML…');
  let bytes;
  try {
    bytes = await ctx.printHtml({
      filePath: file,
      pageSize,
      landscape,
      printBackground,
      marginMm: margin,
      signal: ctx.signal,
    });
  } catch (e) {
    if (e instanceof ToolError || isAbort(e)) throw e;
    throw new ToolError('INTERNAL', 'Không in được HTML.');
  }
  // Huỷ trong lúc in không được xuất file dở dang.
  ctx.signal.throwIfAborted();
  if (!Buffer.isBuffer(bytes) || !bytes.length
    || bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new ToolError('INTERNAL', 'Không in được HTML.');
  }

  const root = ctx.outputDir || path.dirname(file);
  const name = `${splitExt(file).base}-html.pdf`;
  fs.mkdirSync(ctx.tempDir, { recursive: true });
  const tempFile = path.join(ctx.tempDir, name);
  fs.writeFileSync(tempFile, bytes, { flag: 'wx' });
  ctx.signal.throwIfAborted();
  const dest = publishUnique(tempFile, root, name);
  ctx.progress('done', 1, 1, 'Đã tạo PDF từ HTML');
  return {
    outputs: [{ path: dest }],
    errors: [],
    stats: { pageSize, landscape, printBackground, margin },
  };
}

module.exports = { htmlTool, resolveOptions };
