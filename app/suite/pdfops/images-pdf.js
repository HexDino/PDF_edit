const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument } = require('pdf-lib');
const { ToolError } = require('../errors');
const { splitExt, publishUnique } = require('../util/paths');

const MM_TO_PT = 72 / 25.4;
// Khổ giấy tính bằng point, hướng dọc. Hướng ngang hoán đổi hai cạnh.
const PAGE_SIZES = {
  A4: { width: 595.28, height: 841.89 },
  A3: { width: 841.89, height: 1190.55 },
  Letter: { width: 612, height: 792 },
};
const ORIENTATIONS = new Set(['auto', 'portrait', 'landscape']);
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

function invalidImage() {
  return new ToolError('INVALID_FILE', 'Không đọc được ảnh.');
}

function isAbort(error) {
  return error?.name === 'AbortError' || error?.code === 'CANCELLED';
}

function resolveOptions(options = {}) {
  const pageSize = options.pageSize ?? 'A4';
  if (pageSize !== 'auto' && !PAGE_SIZES[pageSize]) {
    throw new ToolError('INVALID_OPTIONS', 'Khổ giấy không hợp lệ.');
  }
  const orientation = options.orientation ?? 'auto';
  if (!ORIENTATIONS.has(orientation)) {
    throw new ToolError('INVALID_OPTIONS', 'Hướng trang không hợp lệ.');
  }
  const margin = options.margin ?? 10;
  if (!Number.isInteger(margin) || margin < 0 || margin > 50) {
    throw new ToolError('INVALID_OPTIONS', 'Lề không hợp lệ.');
  }
  return { pageSize, orientation, margin };
}

/**
 * Kích thước trang theo khổ/hướng. Khổ auto lấy kích thước ảnh (point) cộng
 * lề; nếu người dùng chỉ định hướng ngược với ảnh thì hoán đổi hai cạnh.
 */
function pageDimensions(pageSize, orientation, imageWidth, imageHeight, marginPt) {
  if (pageSize === 'auto') {
    let width = imageWidth + 2 * marginPt;
    let height = imageHeight + 2 * marginPt;
    if (orientation === 'portrait' && width > height) [width, height] = [height, width];
    else if (orientation === 'landscape' && width < height) [width, height] = [height, width];
    return { width, height };
  }
  const portrait = PAGE_SIZES[pageSize];
  const landscape = orientation === 'landscape'
    || (orientation === 'auto' && imageWidth > imageHeight);
  return landscape
    ? { width: portrait.height, height: portrait.width }
    : { width: portrait.width, height: portrait.height };
}

/** Nhúng ảnh vào PDF; WebP phải qua worker chuyển PNG trước. */
async function embedImage(doc, file, ctx) {
  const ext = path.extname(file).toLowerCase();
  if (!IMAGE_EXTS.has(ext)) throw invalidImage();

  if (ext === '.webp') {
    if (!ctx.image || typeof ctx.image.toPng !== 'function') {
      throw new ToolError('INTERNAL', 'Không xử lý được ảnh.');
    }
    let converted;
    try {
      converted = await ctx.image.toPng(file);
    } catch (e) {
      if (e instanceof ToolError || isAbort(e)) throw e;
      throw invalidImage();
    }
    ctx.signal.throwIfAborted();
    if (!converted || typeof converted.path !== 'string' || !converted.path) throw invalidImage();
    try {
      return await doc.embedPng(fs.readFileSync(converted.path));
    } catch (e) {
      if (isAbort(e)) throw e;
      throw invalidImage();
    }
  }

  let bytes;
  try {
    bytes = fs.readFileSync(file);
  } catch {
    throw invalidImage();
  }
  ctx.signal.throwIfAborted();
  try {
    return ext === '.png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  } catch (e) {
    if (isAbort(e)) throw e;
    throw invalidImage();
  }
}

async function imagesTool(ctx) {
  const files = Array.isArray(ctx.files) ? ctx.files : [];
  if (!files.length) throw new ToolError('INVALID_FILE', 'Chưa chọn ảnh.');
  ctx.signal.throwIfAborted();

  const { pageSize, orientation, margin } = resolveOptions(ctx.options);
  const marginPt = margin * MM_TO_PT;
  const total = files.length;
  const doc = await PDFDocument.create();

  ctx.progress('processing', 0, total, 'Đang thêm ảnh…');
  for (let i = 0; i < total; i++) {
    ctx.signal.throwIfAborted();
    const image = await embedImage(doc, files[i], ctx);
    ctx.signal.throwIfAborted();

    const { width, height } = pageDimensions(
      pageSize, orientation, image.width, image.height, marginPt,
    );
    const printableWidth = width - 2 * marginPt;
    const printableHeight = height - 2 * marginPt;
    const scale = Math.min(printableWidth / image.width, printableHeight / image.height);
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    const page = doc.addPage([width, height]);
    page.drawImage(image, {
      x: marginPt + (printableWidth - drawWidth) / 2,
      y: marginPt + (printableHeight - drawHeight) / 2,
      width: drawWidth,
      height: drawHeight,
    });
    ctx.progress('processing', i + 1, total, `Đang thêm ảnh ${i + 1}/${total}…`);
  }

  // Huỷ sau ảnh cuối vẫn không được xuất file dở dang.
  ctx.signal.throwIfAborted();
  const bytes = await doc.save();
  ctx.signal.throwIfAborted();

  const root = ctx.outputDir || path.dirname(files[0]);
  const base = splitExt(files[0]).base;
  fs.mkdirSync(ctx.tempDir, { recursive: true });
  const tempFile = path.join(ctx.tempDir, `${base}-anh.pdf`);
  fs.writeFileSync(tempFile, bytes, { flag: 'wx' });
  const dest = publishUnique(tempFile, root, `${base}-anh.pdf`);
  ctx.progress('done', total, total, 'Đã tạo PDF từ ảnh');
  return { outputs: [{ path: dest }], errors: [], stats: { pages: total, images: total } };
}

module.exports = { imagesTool, pageDimensions };
