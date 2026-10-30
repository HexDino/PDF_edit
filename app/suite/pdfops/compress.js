const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument, PDFName } = require('pdf-lib');
const { ToolError } = require('../errors');
const { validateOptions } = require('../schema');
const { parsePageRange } = require('../pages');
const { outputName, publishUnique } = require('../util/paths');

const compressOptions = [
  { key: 'mode', type: 'enum', values: ['lossless', 'raster'], labels: { lossless: 'Không mất dữ liệu (qpdf)', raster: 'Raster hoá (mất lớp chữ)' }, default: 'lossless', label: 'Cách nén' },
  { key: 'pages', type: 'range', default: '', label: 'Khoảng trang', placeholder: 'Chỉ dùng khi raster (trống = tất cả)' },
  { key: 'dpi', type: 'int', min: 72, max: 600, default: 150, label: 'DPI khi raster' },
  { key: 'format', type: 'enum', values: ['jpg', 'png'], labels: { jpg: 'JPEG — nhẹ hơn', png: 'PNG — nét hơn' }, default: 'jpg', label: 'Định dạng ảnh' },
  { key: 'quality', type: 'int', min: 60, max: 100, default: 80, label: 'Chất lượng JPEG (%)' },
];

// qpdf chỉ báo sai/thiếu mật khẩu khi mở file đầu vào đã mã hoá.
// Không bao giờ đưa nguyên văn stderr (có thể chứa đường dẫn) ra UI.
const PASSWORD_RE = /invalid password|file is encrypted|password required/i;
const ROTATIONS = new Set([0, 90, 180, 270]);

function optionsFor(input) {
  try {
    // Chỉ undefined được thay bằng {}; null/array/kiểu khác vẫn phải bị schema từ chối.
    return validateOptions({ options: compressOptions }, input === undefined ? {} : input);
  } catch {
    throw new ToolError('INVALID_OPTIONS', 'Tuỳ chọn nén không hợp lệ.');
  }
}

// qpdf trả mã 3 khi có cảnh báo nhưng vẫn tạo được file (vd. PDF hỏng nhẹ).
// Chỉ chấp nhận mã 3 khi file tạm thực sự dùng được; còn lại vẫn là lỗi.
function hasUsableOutput(file) {
  try {
    return fs.statSync(file).size > 0;
  } catch {
    return false;
  }
}

function discard(file) {
  if (typeof file !== 'string' || !file) return;
  try { fs.rmSync(file, { force: true }); } catch { /* temp sẽ được job dọn dẹp */ }
}

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

// PDF.js nhân kích thước viewport với /UserUnit; giá trị thiếu = 1, <= 0 là file hỏng.
function userUnit(page) {
  const value = page.node.lookup(PDFName.of('UserUnit'));
  if (value === undefined) return 1;
  const unit = value && typeof value.asNumber === 'function' ? value.asNumber() : NaN;
  if (!Number.isFinite(unit) || unit <= 0) {
    throw new ToolError('INVALID_FILE', 'Trang có đơn vị kích thước không hợp lệ.');
  }
  return unit;
}

// Kích thước khung nhìn của trang: CropBox ∩ MediaBox, nhân /UserUnit, đổi chỗ
// rộng/cao khi trang xoay 90/270 — khớp với viewport mà render worker dùng để xuất ảnh.
function visibleSize(page) {
  const media = page.getMediaBox();
  const crop = page.getCropBox();
  const x = Math.max(media.x, crop.x);
  const y = Math.max(media.y, crop.y);
  const right = Math.min(media.x + media.width, crop.x + crop.width);
  const bottom = Math.min(media.y + media.height, crop.y + crop.height);
  const unit = userUnit(page);
  let width = (right - x) * unit;
  let height = (bottom - y) * unit;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new ToolError('INVALID_FILE', 'Trang có vùng hiển thị không hợp lệ.');
  }
  const angle = (((page.getRotation().angle % 360) + 360) % 360);
  if (!ROTATIONS.has(angle)) {
    throw new ToolError('INVALID_FILE', 'Trang có góc xoay không hợp lệ.');
  }
  if (angle === 90 || angle === 270) [width, height] = [height, width];
  return { width, height };
}

// Kiểm tra worker trả đủ trang đã yêu cầu trước khi dựng PDF kết quả; nhờ vậy
// job lỗi/thiếu trang không để lại file dở dang.
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

async function compressLossless(ctx, file) {
  const tmp = path.join(ctx.tempDir, 'compressed.pdf');
  ctx.progress('processing', 0, 1, 'Đang nén…');
  try {
    await ctx.qpdf([
      '--object-streams=generate',
      '--recompress-flate',
      '--compression-level=9',
      '--', file, tmp,
    ]);
  } catch (e) {
    if (e.code === 'CANCELLED' || e.name === 'AbortError') {
      discard(tmp);
      throw e;
    }
    if (e.code === 'ENOENT') {
      discard(tmp);
      throw new ToolError('BINARY_MISSING', 'Thiếu qpdf để nén PDF. Chạy npm run fetch:qpdf rồi thử lại.');
    }
    // qpdf exit code 3 = chỉ có cảnh báo; file tạm vẫn dùng được.
    if (!(e.exitCode === 3 && hasUsableOutput(tmp))) {
      discard(tmp);
      if (PASSWORD_RE.test(`${e.stderr || ''} ${e.message || ''}`)) {
        throw new ToolError('PASSWORD_REQUIRED', 'PDF có mật khẩu. Hãy mở khoá trước.');
      }
      throw new ToolError('INVALID_FILE', 'Không đọc được PDF.');
    }
  }
  try {
    ctx.signal?.throwIfAborted?.();
  } catch (e) {
    // qpdf đã tạo file tạm trước khi job bị huỷ: không để nó nằm lại.
    discard(tmp);
    throw e;
  }
  if (!hasUsableOutput(tmp)) {
    discard(tmp);
    throw new ToolError('INTERNAL', 'qpdf không tạo được file.');
  }

  try {
    const out = publishUnique(tmp, ctx.outputDir || path.dirname(file), outputName(file, 'nen'));
    ctx.progress('done', 1, 1, 'Đã nén xong');
    return { output: out, errors: [], rasterPages: 0 };
  } catch (e) {
    discard(tmp);
    throw e;
  }
}

async function compressRaster(ctx, file, options) {
  let rendered = [];
  let renderedFiles = [];
  const tmp = path.join(ctx.tempDir, 'compressed.pdf');
  try {
    ctx.signal?.throwIfAborted?.();
    const src = await loadPdf(file);
    const pageCount = src.getPageCount();
    const selected = new Set(parsePageRange(options.pages, pageCount));
    const pages = [...selected].sort((a, b) => a - b);

    ctx.signal?.throwIfAborted?.();
    rendered = await ctx.render.pdfToImages({
      filePath: file, pages, dpi: options.dpi, format: options.format,
      quality: options.quality / 100, outDir: ctx.tempDir,
      signal: ctx.signal,
      progress: (done, total) => ctx.progress('processing', done, total, `Đang raster hoá trang ${done}/${total}…`),
    });
    // Ghi lại đường dẫn ngay khi worker trả về: nếu assert/abort dưới đây thất bại
    // thì catch vẫn biết ảnh nào cần xoá.
    renderedFiles = Array.isArray(rendered)
      ? rendered
        .map(item => (item && typeof item.path === 'string' && item.path ? item.path : null))
        .filter(Boolean)
      : [];
    ctx.signal?.throwIfAborted?.();
    assertRendered(rendered, pages);
    const imageFor = new Map(rendered.map(item => [item.page, item.path]));

    const out = await PDFDocument.create();
    const untouched = [];
    for (let i = 0; i < pageCount; i++) if (!selected.has(i + 1)) untouched.push(i);
    const copied = untouched.length ? await out.copyPages(src, untouched) : [];
    let copyCursor = 0;

    for (let i = 0; i < pageCount; i++) {
      ctx.signal?.throwIfAborted?.();
      if (selected.has(i + 1)) {
        const size = visibleSize(src.getPage(i));
        const page = out.addPage([size.width, size.height]);
        const bytes = fs.readFileSync(imageFor.get(i + 1));
        // quality đã áp dụng lúc render; pdf-lib chỉ nhúng lại ảnh đã có.
        const image = options.format === 'png' ? await out.embedPng(bytes) : await out.embedJpg(bytes);
        page.drawImage(image, { x: 0, y: 0, width: size.width, height: size.height });
      } else {
        out.addPage(copied[copyCursor++]);
      }
    }
    ctx.signal?.throwIfAborted?.();

    fs.writeFileSync(tmp, await out.save());
    ctx.signal?.throwIfAborted?.();
    const outPath = publishUnique(tmp, ctx.outputDir || path.dirname(file), outputName(file, 'nen'));
    // Ảnh đã nhúng xong; dọn ngay để tempDir sạch sau khi xuất bản.
    for (const item of renderedFiles) discard(item);
    renderedFiles = [];
    ctx.progress('done', 1, 1, 'Đã nén xong');
    return {
      output: outPath,
      rasterPages: selected.size,
      errors: selected.size
        ? [{
          file,
          code: 'TEXT_LAYER_REMOVED',
          message: 'Trang đã được raster hoá; lớp chữ trên các trang đó không còn.',
        }]
        : [],
    };
  } catch (e) {
    discard(tmp);
    for (const item of renderedFiles) discard(item);
    if (e instanceof ToolError || e?.code === 'CANCELLED' || e?.name === 'AbortError') throw e;
    throw new ToolError('INTERNAL', 'Không tạo được PDF nén.');
  }
}

async function compressTool(ctx) {
  const options = optionsFor(ctx.options);
  ctx.signal?.throwIfAborted?.();
  const file = ctx.files?.[0];
  if (typeof file !== 'string' || !file) {
    throw new ToolError('INVALID_FILE', 'Chưa chọn file.');
  }
  let beforeBytes;
  try {
    beforeBytes = fs.statSync(file).size;
  } catch {
    throw new ToolError('INVALID_FILE', 'File không tồn tại hoặc đã bị di chuyển.');
  }

  const result = options.mode === 'raster'
    ? await compressRaster(ctx, file, options)
    : await compressLossless(ctx, file);

  let afterBytes;
  try {
    afterBytes = fs.statSync(result.output).size;
  } catch {
    throw new ToolError('INTERNAL', 'Không tạo được file kết quả.');
  }
  const savedPercent = beforeBytes > 0
    ? Math.round((1 - afterBytes / beforeBytes) * 100)
    : 0;

  return {
    outputs: [{ path: result.output }],
    errors: result.errors,
    stats: {
      beforeBytes,
      afterBytes,
      savedPercent,
      mode: options.mode,
      rasterPages: result.rasterPages,
    },
  };
}

module.exports = { compressTool, compressOptions };
