const fs = require('node:fs');
const path = require('node:path');
const {
  PDFDocument, PDFName, PDFDict, PDFArray, PDFRef, EncryptedPDFError,
} = require('pdf-lib');
const { ToolError } = require('../errors');
const { outputName, publishUnique } = require('../util/paths');

// Tuỳ chọn mặc định bật; giá trị lạ bị chặn trước khi đọc/ghi file.
function readFlag(options, key) {
  const value = options?.[key];
  if (value === undefined) return true;
  if (typeof value !== 'boolean') {
    throw new ToolError('INVALID_OPTIONS', 'Tuỳ chọn xoá metadata không hợp lệ.');
  }
  return value;
}

async function loadPdf(file) {
  try {
    // updateMetadata: false để pdf-lib không tự ghi đè Producer/Creator/Ngày
    // trước khi công cụ kịp xoá chúng.
    const doc = await PDFDocument.load(fs.readFileSync(file), { updateMetadata: false });
    // pdf-lib đọc lười trang; gọi sớm để PDF hỏng bị bắt ngay tại đây.
    doc.getPageCount();
    return doc;
  } catch (e) {
    if (e instanceof EncryptedPDFError || /encrypt/i.test(e.message || '')) {
      throw new ToolError('PASSWORD_REQUIRED', 'PDF có mật khẩu. Hãy mở khoá trước.');
    }
    throw new ToolError('INVALID_FILE', 'Không đọc được PDF.');
  }
}

function clearInfo(doc) {
  doc.setTitle('');
  doc.setAuthor('');
  doc.setSubject('');
  doc.setCreator('');
  doc.setProducer('');
  doc.setKeywords([]);
}

// XMP là một stream gắn ở catalog. Xoá tham chiếu rồi xoá luôn object để
// pdf-lib không ghi lại gói XMP đã tách rời vào file kết quả.
function removeXmp(doc) {
  const key = PDFName.of('Metadata');
  if (!doc.catalog.has(key)) return false;
  const value = doc.catalog.get(key);
  doc.catalog.delete(key);
  if (value instanceof PDFRef) doc.context.delete(value);
  return true;
}

// Đếm tệp trong cây tên /EmbeddedFiles (gồm cả nút con /Kids) và ghi lại
// tham chiếu Filespec để dọn các mục /AF tương ứng ở catalog.
function collectNameTree(node, refs, seen = new Set()) {
  if (!node || seen.has(node)) return 0;
  seen.add(node);
  let count = 0;
  const names = node.lookupMaybe(PDFName.of('Names'), PDFArray);
  if (names) {
    count += Math.floor(names.size() / 2);
    for (let i = 1; i < names.size(); i += 2) {
      const value = names.get(i);
      if (value instanceof PDFRef) refs.add(value);
    }
  }
  const kids = node.lookupMaybe(PDFName.of('Kids'), PDFArray);
  if (kids) {
    for (let i = 0; i < kids.size(); i++) {
      const kid = kids.lookupMaybe(i, PDFDict);
      if (kid) count += collectNameTree(kid, refs, seen);
    }
  }
  return count;
}

// Bỏ /Names/EmbeddedFiles; /Names chỉ bị xoá khi không còn mục nào khác.
// pdf-lib attach còn gắn cùng Filespec vào catalog /AF nên phải bỏ luôn,
// nếu không tệp vẫn còn là "associated file" dù đã rời cây tên.
function removeEmbeddedFiles(doc) {
  const names = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  if (!names) return 0;
  const key = PDFName.of('EmbeddedFiles');
  const refs = new Set();
  let count = 0;
  const embedded = names.lookupMaybe(key, PDFDict);
  if (embedded) {
    count = collectNameTree(embedded, refs);
    names.delete(key);
  }
  if (names.keys().length === 0) doc.catalog.delete(PDFName.of('Names'));

  const af = doc.catalog.lookupMaybe(PDFName.of('AF'), PDFArray);
  if (af && refs.size) {
    for (let i = af.size() - 1; i >= 0; i--) {
      const value = af.get(i);
      if (value instanceof PDFRef && refs.has(value)) af.remove(i);
    }
    if (af.size() === 0) doc.catalog.delete(PDFName.of('AF'));
  }
  return count;
}

async function metadataTool(ctx) {
  const file = ctx.files[0];
  const removeInfo = readFlag(ctx.options, 'removeInfo');
  const removeXmpFlag = readFlag(ctx.options, 'removeXmp');
  const removeAttachments = readFlag(ctx.options, 'removeAttachments');
  if (!removeInfo && !removeXmpFlag && !removeAttachments) {
    throw new ToolError('INVALID_OPTIONS', 'Hãy chọn ít nhất một loại metadata để xoá.');
  }

  ctx.signal.throwIfAborted();
  const doc = await loadPdf(file);
  ctx.signal.throwIfAborted();

  ctx.progress('processing', 0, 1, 'Đang xoá metadata…');
  if (removeInfo) clearInfo(doc);
  const xmpRemoved = removeXmpFlag ? removeXmp(doc) : false;
  const attachmentsRemoved = removeAttachments ? removeEmbeddedFiles(doc) : 0;
  ctx.signal.throwIfAborted();

  const tmp = path.join(ctx.tempDir, 'metadata.pdf');
  // Chỉ ghi metadata đã xoá: không tự thêm trang, không cập nhật appearance
  // của form (công cụ này không được đụng nội dung trang).
  fs.writeFileSync(tmp, await doc.save({ addDefaultPage: false, updateFieldAppearances: false }));
  ctx.signal.throwIfAborted();

  const outDir = ctx.outputDir || path.dirname(file);
  const out = publishUnique(tmp, outDir, outputName(file, 'xoa-metadata'));
  ctx.progress('done', 1, 1, 'Đã xoá metadata');
  return {
    outputs: [{ path: out }],
    errors: [],
    stats: {
      removed: { info: removeInfo, xmp: xmpRemoved, attachments: attachmentsRemoved },
    },
  };
}

module.exports = { metadataTool };
