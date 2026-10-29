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

// Xoá cả dictionary Info khỏi trailer thay vì chỉ làm rỗng vài trường: ngày
// tạo/ngày sửa và các khoá tuỳ biến (/Company…) cũng là dữ liệu nhận dạng.
// Trả về true nếu file gốc thực sự có Info.
function clearInfo(doc) {
  const info = doc.context.trailerInfo.Info;
  if (info === undefined) return false;
  delete doc.context.trailerInfo.Info;
  if (info instanceof PDFRef) doc.context.delete(info);
  return true;
}

// Bỏ /Metadata khỏi một dictionary (catalog hoặc trang) và xoá luôn stream
// object để gói XMP không bị ghi lại dưới dạng object mồ côi.
function removeMetadata(doc, dict, key) {
  if (!dict.has(key)) return false;
  const value = dict.get(key);
  dict.delete(key);
  if (value instanceof PDFRef) doc.context.delete(value);
  return true;
}

// XMP có thể nằm ở catalog (chuẩn) và cả ở từng trang. Phải quét cả hai.
function removeXmp(doc) {
  const key = PDFName.of('Metadata');
  let removed = removeMetadata(doc, doc.catalog, key);
  for (const page of doc.getPages()) {
    if (removeMetadata(doc, page.node, key)) removed = true;
  }
  return removed;
}

// Đếm tệp trong cây tên /EmbeddedFiles (gồm cả nút con /Kids) và ghi lại
// các Filespec để đối chiếu, tránh đếm trùng với catalog /AF.
function collectNameTree(node, entries, seen = new Set()) {
  if (!node || seen.has(node)) return 0;
  seen.add(node);
  let count = 0;
  const names = node.lookupMaybe(PDFName.of('Names'), PDFArray);
  if (names) {
    count += Math.floor(names.size() / 2);
    for (let i = 1; i < names.size(); i += 2) {
      const value = names.get(i);
      if (value instanceof PDFRef || value instanceof PDFDict) entries.add(value);
    }
  }
  const kids = node.lookupMaybe(PDFName.of('Kids'), PDFArray);
  if (kids) {
    for (let i = 0; i < kids.size(); i++) {
      const kid = kids.lookupMaybe(i, PDFDict);
      if (kid) count += collectNameTree(kid, entries, seen);
    }
  }
  return count;
}

// pdf-lib ghi mọi object đã đọc, kể cả object không còn ai tham chiếu. Sau khi
// bỏ cây tên đính kèm, dọn các object mồ côi (Filespec, EmbeddedFile…) để dữ
// liệu tệp đính kèm không còn nằm trong file kết quả.
function gcUnreachable(doc) {
  const reachable = new Set();
  const visit = value => {
    if (value instanceof PDFRef) {
      if (reachable.has(value)) return;
      reachable.add(value);
      visit(doc.context.lookup(value));
      return;
    }
    if (value instanceof PDFArray) {
      for (let i = 0; i < value.size(); i++) visit(value.get(i));
      return;
    }
    if (value instanceof PDFDict) {
      for (const child of value.values()) visit(child);
      return;
    }
    if (value?.dict instanceof PDFDict) visit(value.dict);
  };
  for (const root of Object.values(doc.context.trailerInfo)) visit(root);
  for (const [ref] of doc.context.enumerateIndirectObjects()) {
    if (!reachable.has(ref)) doc.context.delete(ref);
  }
}

// Bỏ /Names/EmbeddedFiles; /Names chỉ bị xoá khi không còn mục nào khác.
// pdf-lib attach còn gắn cùng Filespec vào catalog /AF nên phải bỏ luôn,
// nếu không tệp vẫn còn là "associated file" dù đã rời cây tên. /AF có thể
// tồn tại một mình (không có /Names/EmbeddedFiles) nên xử lý độc lập.
function removeEmbeddedFiles(doc) {
  const names = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  const key = PDFName.of('EmbeddedFiles');
  const entries = new Set();
  let count = 0;
  if (names) {
    const embedded = names.lookupMaybe(key, PDFDict);
    if (embedded) {
      count = collectNameTree(embedded, entries);
      names.delete(key);
    }
    if (names.keys().length === 0) doc.catalog.delete(PDFName.of('Names'));
  }

  // Xoá toàn bộ /AF ở catalog; mục /AF không có trong cây tên vẫn là tệp
  // đính kèm và phải được đếm (không đếm trùng mục đã có trong cây tên).
  const af = doc.catalog.lookupMaybe(PDFName.of('AF'), PDFArray);
  if (af) {
    for (let i = af.size() - 1; i >= 0; i--) {
      const value = af.get(i);
      if (value instanceof PDFRef || value instanceof PDFDict) {
        if (!entries.has(value)) {
          entries.add(value);
          count += 1;
        }
      }
    }
    doc.catalog.delete(PDFName.of('AF'));
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
  const infoRemoved = removeInfo ? clearInfo(doc) : false;
  const xmpRemoved = removeXmpFlag ? removeXmp(doc) : false;
  const attachmentsRemoved = removeAttachments ? removeEmbeddedFiles(doc) : 0;
  // Luôn dọn object không còn reachable từ trailer: bản revision tăng dần
  // trước đây có thể còn Info/XMP/Filespec mồ côi dù trailer/catalog hiện tại
  // không tham chiếu. Object vẫn reachable (metadata không chọn xoá) được giữ,
  // nên ngữ nghĩa tuỳ chọn từng phần không đổi.
  gcUnreachable(doc);
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
      removed: { info: infoRemoved, xmp: xmpRemoved, attachments: attachmentsRemoved },
    },
  };
}

module.exports = { metadataTool };
