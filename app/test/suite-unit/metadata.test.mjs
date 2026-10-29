import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const {
  PDFDocument, PDFName, PDFDict, PDFString, PDFHexString,
} = require('pdf-lib');
const { metadataTool } = require('../../suite/pdfops/metadata.js');
const { runProcess } = require('../../suite/util/spawn.js');
const { binaryPath } = require('../../suite/util/paths.js');

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const qpdf = (args, opts = {}) => runProcess(
  binaryPath('qpdf.exe', { appRoot: APP_ROOT, isPackaged: false }),
  args, opts,
);

const XMP_MARKER = 'SECRET-XMP-MARKER';
const PAGE_XMP_MARKER = 'SECRET-PAGE-XMP-MARKER';
const COMPANY_MARKER = 'SECRET-INFO-COMPANY';
const AF_MARKER = 'SECRET-AF-ONLY-PAYLOAD';
const ORPHAN_INFO_MARKER = 'SECRET-ORPHAN-AUTHOR';
const ORPHAN_INFO_KEY = 'SECRET-ORPHAN-COMPANY';
const ORPHAN_XMP_MARKER = 'SECRET-ORPHAN-XMP';
const ORPHAN_PAYLOAD_MARKER = 'SECRET-ORPHAN-PAYLOAD';
const XMP = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
   <dc:title>${XMP_MARKER}</dc:title>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;

function ctxFor(file, dir, options = {}, overrides = {}) {
  const tempDir = fs.mkdtempSync(path.join(dir, 'tmp-'));
  return {
    files: [file], tempDir, outputDir: dir, signal: new AbortController().signal,
    options, progress() {}, log() {}, ...overrides,
  };
}

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsp-metadata-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Đọc output mà không để pdf-lib tự điền Producer/ModDate (updateMetadata).
const loadOutput = file => PDFDocument.load(fs.readFileSync(file), { updateMetadata: false });

// Loại của mọi object còn trong file kết quả, kể cả object mồ côi.
async function objectTypes(file) {
  const doc = await loadOutput(file);
  return doc.context.enumerateIndirectObjects().map(([, obj]) => {
    const dict = obj instanceof PDFDict ? obj : obj?.dict;
    return dict instanceof PDFDict ? dict.get(PDFName.of('Type'))?.asString() : undefined;
  }).filter(Boolean);
}

// Giải nén object stream và giữ cả object không được tham chiếu (qpdf mặc
// định bỏ chúng) để marker nằm trong object nén vẫn bị phát hiện.
async function decodedOutput(file, dir) {
  const decoded = path.join(dir, 'decoded.pdf');
  await qpdf(['--qdf', '--preserve-unreferenced', '--object-streams=disable', file, decoded]);
  return fs.readFileSync(decoded);
}

/**
 * PDF nhiều metadata: Info đầy đủ, XMP không nén, và các tệp đính kèm.
 * pdf-lib attach tạo cả /Names/EmbeddedFiles lẫn /AF như người dùng thật.
 */
async function makeRichPdf(file, {
  info = true, xmp = true, attachments = 2, otherNames = false, pageXmp = false,
} = {}) {
  const doc = await PDFDocument.create();
  doc.addPage([300, 400]);
  doc.addPage([300, 400]);
  if (info) {
    doc.setTitle('Tài liệu mật');
    doc.setAuthor('Nguyễn Văn A');
    doc.setSubject('Chủ đề nội bộ');
    doc.setKeywords(['bí mật', 'nội bộ']);
    doc.setCreator('Trình tạo bí mật');
    doc.setProducer('Máy in bí mật');
    doc.setCreationDate(new Date('2019-05-06T07:08:09Z'));
    doc.setModificationDate(new Date('2020-06-07T08:09:10Z'));
    doc.getInfoDict().set(PDFName.of('Company'), PDFString.of(COMPANY_MARKER));
  }
  if (xmp) {
    const stream = doc.context.stream(XMP, { Type: 'Metadata', Subtype: 'XML' });
    doc.catalog.set(PDFName.of('Metadata'), doc.context.register(stream));
  }
  if (pageXmp) {
    const stream = doc.context.stream(PAGE_XMP_MARKER, { Type: 'Metadata', Subtype: 'XML' });
    doc.getPage(0).node.set(PDFName.of('Metadata'), doc.context.register(stream));
  }
  if (otherNames) {
    if (!doc.catalog.has(PDFName.of('Names'))) {
      doc.catalog.set(PDFName.of('Names'), doc.context.obj({}));
    }
    doc.catalog.lookup(PDFName.of('Names')).set(PDFName.of('Dests'), doc.context.obj({}));
  }
  for (let i = 1; i <= attachments; i++) {
    await doc.attach(
      Buffer.from(`nội dung đính kèm bí mật ${i}`),
      `dinh-kem-${i}.txt`,
      { mimeType: 'text/plain' },
    );
  }
  fs.writeFileSync(file, await doc.save());
  return file;
}

/**
 * Mô phỏng PDF đã qua revision tăng dần: Info/XMP/Filespec của revision cũ
 * vẫn nằm trong object table nhưng trailer/catalog hiện tại không tham chiếu.
 * pdf-lib giữ nguyên các object này khi đọc, nên công cụ phải dọn trước khi ghi.
 */
async function makeOrphanPdf(file) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.addPage([200, 300]);
  doc.setTitle('Tiêu đề thật');
  doc.setAuthor('Tác giả thật');
  doc.context.register(doc.context.obj({
    Author: PDFString.of(ORPHAN_INFO_MARKER),
    Company: PDFString.of(ORPHAN_INFO_KEY),
  }));
  doc.context.register(doc.context.stream(ORPHAN_XMP_MARKER, {
    Type: 'Metadata', Subtype: 'XML',
  }));
  const embedded = doc.context.stream(ORPHAN_PAYLOAD_MARKER, { Type: 'EmbeddedFile' });
  doc.context.register(doc.context.obj({
    Type: 'Filespec',
    F: PDFString.of('orphan.txt'),
    EF: { F: doc.context.register(embedded) },
  }));
  // XMP thật (có tham chiếu) để kiểm tra xoá XMP bình thường vẫn hoạt động.
  const xmp = doc.context.stream(XMP, { Type: 'Metadata', Subtype: 'XML' });
  doc.catalog.set(PDFName.of('Metadata'), doc.context.register(xmp));
  // Lưu không nén object stream để khẳng định fixture thật sự chứa marker.
  fs.writeFileSync(file, await doc.save({ useObjectStreams: false }));
  return file;
}

async function lockedCopy(src, dir, name = 'locked.pdf') {
  const locked = path.join(dir, name);
  await qpdf(['--encrypt', '--user-password=secret', '--owner-password=owner', '--bits=256', '--', src, locked]);
  return locked;
}

test('mặc định xoá Info, XMP và tệp đính kèm; báo cáo đúng số lượng', async t => {
  const dir = tempDir(t);
  const file = await makeRichPdf(path.join(dir, 'nguon.pdf'), { pageXmp: true });

  const ctx = ctxFor(file, dir);
  const r = await metadataTool(ctx);
  assert.equal(r.outputs.length, 1);
  const out = r.outputs[0].path;
  assert.equal(path.basename(out), 'nguon-xoa-metadata.pdf');
  assert.equal(path.dirname(path.resolve(out)), path.resolve(dir));
  assert.deepEqual(r.stats.removed, { info: true, xmp: true, attachments: 2 });

  const doc = await loadOutput(out);
  assert.equal(doc.getPageCount(), 2, 'không được đổi số trang');
  // Info phải biến mất khỏi trailer, không chỉ rỗng vài trường.
  assert.equal(doc.context.trailerInfo.Info, undefined, 'trailer không còn /Info');
  assert.equal(doc.getCreationDate(), undefined, 'CreationDate phải bị xoá');
  assert.equal(doc.getModificationDate(), undefined, 'ModDate phải bị xoá');
  assert.equal(doc.getInfoDict().get(PDFName.of('Company')), undefined, 'khoá tuỳ biến phải bị xoá');
  for (const [label, value] of [
    ['title', doc.getTitle()], ['author', doc.getAuthor()], ['subject', doc.getSubject()],
    ['creator', doc.getCreator()], ['producer', doc.getProducer()], ['keywords', doc.getKeywords()],
  ]) {
    assert.equal(value, undefined, `Info ${label} phải bị xoá (Info vắng mặt)`);
  }
  assert.equal(doc.catalog.has(PDFName.of('Metadata')), false, 'catalog không còn /Metadata');
  for (const page of doc.getPages()) {
    assert.equal(page.node.has(PDFName.of('Metadata')), false, 'trang không còn /Metadata');
  }
  assert.equal(doc.catalog.has(PDFName.of('Names')), false, '/Names rỗng phải bị xoá');
  assert.equal(doc.catalog.has(PDFName.of('AF')), false, '/AF của tệp đính kèm phải bị bỏ');
  const outBytes = fs.readFileSync(out);
  for (const marker of [
    XMP_MARKER, PAGE_XMP_MARKER, 'CreationDate', 'ModDate', '/Company', COMPANY_MARKER,
  ]) {
    assert.equal(outBytes.includes(Buffer.from(marker)), false, `không còn ${marker} trong file`);
  }
  assert.equal(outBytes.includes(Buffer.from('D:2019')), false, 'ngày tạo không còn trong file');

  const listed = await qpdf(['--list-attachments', out]);
  // qpdf in "has no embedded files" khi không còn tệp; chỉ cần không có tên tệp.
  assert.doesNotMatch(listed.stdout, /dinh-kem/);
  const types = await objectTypes(out);
  assert.equal(types.includes('/Filespec'), false, 'không còn object Filespec mồ côi');
  assert.equal(types.includes('/EmbeddedFile'), false, 'không còn object EmbeddedFile mồ côi');
  assert.equal(types.includes('/Metadata'), false, 'không còn object XMP mồ côi');
  await qpdf(['--check', out]);
  assert.deepEqual(fs.readdirSync(ctx.tempDir), [], 'không để lại file tạm');
});

test('chỉ xoá Info: XMP và tệp đính kèm còn nguyên', async t => {
  const dir = tempDir(t);
  const file = await makeRichPdf(path.join(dir, 'nguon.pdf'), { pageXmp: true });

  const r = await metadataTool(ctxFor(file, dir, {
    removeInfo: true, removeXmp: false, removeAttachments: false,
  }));
  assert.deepEqual(r.stats.removed, { info: true, xmp: false, attachments: 0 });

  const out = r.outputs[0].path;
  const doc = await loadOutput(out);
  assert.equal(doc.context.trailerInfo.Info, undefined, 'trailer không còn /Info');
  assert.equal(doc.getTitle(), undefined);
  assert.equal(doc.getAuthor(), undefined);
  assert.equal(doc.catalog.has(PDFName.of('Metadata')), true, 'XMP phải được giữ');
  assert.equal(doc.getPage(0).node.has(PDFName.of('Metadata')), true, 'XMP cấp trang phải được giữ');
  assert.equal(fs.readFileSync(out).includes(Buffer.from(PAGE_XMP_MARKER)), true);
  assert.equal(doc.catalog.has(PDFName.of('AF')), true, '/AF phải được giữ');
  const listed = await qpdf(['--list-attachments', out]);
  assert.match(listed.stdout, /dinh-kem-1\.txt/);
  assert.match(listed.stdout, /dinh-kem-2\.txt/);
});

test('chỉ xoá XMP: Info và tệp đính kèm còn nguyên', async t => {
  const dir = tempDir(t);
  const file = await makeRichPdf(path.join(dir, 'nguon.pdf'), { pageXmp: true });

  const r = await metadataTool(ctxFor(file, dir, {
    removeInfo: false, removeXmp: true, removeAttachments: false,
  }));
  assert.deepEqual(r.stats.removed, { info: false, xmp: true, attachments: 0 });

  const out = r.outputs[0].path;
  const doc = await loadOutput(out);
  assert.equal(doc.getTitle(), 'Tài liệu mật');
  assert.equal(doc.getAuthor(), 'Nguyễn Văn A');
  assert.equal(doc.getProducer(), 'Máy in bí mật');
  assert.ok(doc.getCreationDate() instanceof Date, 'CreationDate phải được giữ');
  assert.ok(doc.getModificationDate() instanceof Date, 'ModDate phải được giữ');
  assert.equal(
    doc.getInfoDict().lookup(PDFName.of('Company')).decodeText(),
    COMPANY_MARKER,
    'khoá tuỳ biến phải được giữ',
  );
  assert.equal(doc.catalog.has(PDFName.of('Metadata')), false, 'XMP catalog phải bị xoá');
  assert.equal(doc.getPage(0).node.has(PDFName.of('Metadata')), false, 'XMP cấp trang phải bị xoá');
  const outBytes = fs.readFileSync(out);
  assert.equal(outBytes.includes(Buffer.from(XMP_MARKER)), false);
  assert.equal(outBytes.includes(Buffer.from(PAGE_XMP_MARKER)), false);
  const types = await objectTypes(out);
  assert.equal(types.includes('/Metadata'), false, 'không còn object XMP mồ côi');
  assert.equal(doc.catalog.has(PDFName.of('AF')), true, '/AF phải được giữ');
  const listed = await qpdf(['--list-attachments', out]);
  assert.match(listed.stdout, /dinh-kem-1\.txt/);
});

test('XMP chỉ ở cấp trang: vẫn xoá dù catalog không có /Metadata', async t => {
  const dir = tempDir(t);
  const file = await makeRichPdf(path.join(dir, 'page-xmp.pdf'), {
    xmp: false, pageXmp: true, attachments: 0,
  });

  const r = await metadataTool(ctxFor(file, dir, {
    removeInfo: false, removeXmp: true, removeAttachments: false,
  }));
  assert.deepEqual(r.stats.removed, { info: false, xmp: true, attachments: 0 });
  const outDoc = await loadOutput(r.outputs[0].path);
  assert.equal(outDoc.catalog.has(PDFName.of('Metadata')), false);
  assert.equal(outDoc.getPage(0).node.has(PDFName.of('Metadata')), false);
  assert.equal(
    fs.readFileSync(r.outputs[0].path).includes(Buffer.from(PAGE_XMP_MARKER)),
    false,
    'marker XMP cấp trang không còn',
  );
  const types = await objectTypes(r.outputs[0].path);
  assert.equal(types.includes('/Metadata'), false, 'không còn object XMP mồ côi');
});

test('dọn Info/XMP/Filespec mồ côi còn sót từ revision trước', async t => {
  const dir = tempDir(t);
  const file = await makeOrphanPdf(path.join(dir, 'orphan.pdf'));
  const inputBytes = fs.readFileSync(file);
  for (const marker of [
    ORPHAN_INFO_MARKER, ORPHAN_INFO_KEY, ORPHAN_XMP_MARKER, ORPHAN_PAYLOAD_MARKER,
  ]) {
    assert.equal(inputBytes.includes(Buffer.from(marker)), true, `fixture phải chứa ${marker}`);
  }

  const r = await metadataTool(ctxFor(file, dir));
  assert.deepEqual(r.stats.removed, { info: true, xmp: true, attachments: 0 });

  const out = r.outputs[0].path;
  const outDoc = await loadOutput(out);
  assert.equal(outDoc.context.trailerInfo.Info, undefined, 'trailer không còn /Info');
  assert.equal(outDoc.getTitle(), undefined);
  assert.equal(outDoc.getAuthor(), undefined);
  const types = await objectTypes(out);
  for (const type of ['/Metadata', '/Filespec', '/EmbeddedFile']) {
    assert.equal(types.includes(type), false, `không còn object ${type} mồ côi`);
  }
  const decoded = await decodedOutput(out, dir);
  for (const marker of [
    ORPHAN_INFO_MARKER, ORPHAN_INFO_KEY, ORPHAN_XMP_MARKER, ORPHAN_PAYLOAD_MARKER,
  ]) {
    assert.equal(decoded.includes(Buffer.from(marker)), false, `không còn ${marker} trong file`);
  }
  await qpdf(['--check', out]);
});

test('chỉ xoá XMP vẫn dọn object mồ côi và giữ nguyên Info thật', async t => {
  const dir = tempDir(t);
  const file = await makeOrphanPdf(path.join(dir, 'orphan.pdf'));

  const r = await metadataTool(ctxFor(file, dir, {
    removeInfo: false, removeXmp: true, removeAttachments: false,
  }));
  assert.deepEqual(r.stats.removed, { info: false, xmp: true, attachments: 0 });

  const out = r.outputs[0].path;
  const outDoc = await loadOutput(out);
  assert.equal(outDoc.getTitle(), 'Tiêu đề thật', 'Info thật phải được giữ');
  assert.equal(outDoc.getAuthor(), 'Tác giả thật', 'Info thật phải được giữ');
  assert.equal(outDoc.catalog.has(PDFName.of('Metadata')), false, 'XMP thật phải bị xoá');
  const types = await objectTypes(out);
  for (const type of ['/Metadata', '/Filespec', '/EmbeddedFile']) {
    assert.equal(types.includes(type), false, `không còn object ${type} mồ côi`);
  }
  const decoded = await decodedOutput(out, dir);
  for (const marker of [
    ORPHAN_INFO_MARKER, ORPHAN_INFO_KEY, ORPHAN_XMP_MARKER, ORPHAN_PAYLOAD_MARKER,
  ]) {
    assert.equal(decoded.includes(Buffer.from(marker)), false, `không còn ${marker} trong file`);
  }
  await qpdf(['--check', out]);
});

test('chỉ xoá tệp đính kèm: Info và XMP còn nguyên', async t => {
  const dir = tempDir(t);
  const file = await makeRichPdf(path.join(dir, 'nguon.pdf'));

  const r = await metadataTool(ctxFor(file, dir, {
    removeInfo: false, removeXmp: false, removeAttachments: true,
  }));
  assert.deepEqual(r.stats.removed, { info: false, xmp: false, attachments: 2 });

  const out = r.outputs[0].path;
  const doc = await loadOutput(out);
  assert.equal(doc.getTitle(), 'Tài liệu mật');
  assert.equal(doc.catalog.has(PDFName.of('Metadata')), true);
  assert.equal(doc.catalog.has(PDFName.of('Names')), false);
  assert.equal(doc.catalog.has(PDFName.of('AF')), false);
  const listed = await qpdf(['--list-attachments', out]);
  assert.doesNotMatch(listed.stdout, /dinh-kem/);
  const types = await objectTypes(out);
  assert.equal(types.includes('/Filespec'), false);
  assert.equal(types.includes('/EmbeddedFile'), false);
});

test('xoá EmbeddedFiles nhưng giữ các mục khác trong /Names', async t => {
  const dir = tempDir(t);
  const file = await makeRichPdf(path.join(dir, 'nguon.pdf'), {
    attachments: 1, otherNames: true,
  });

  const r = await metadataTool(ctxFor(file, dir, {
    removeInfo: false, removeXmp: false, removeAttachments: true,
  }));
  assert.equal(r.stats.removed.attachments, 1);

  const doc = await loadOutput(r.outputs[0].path);
  const names = doc.catalog.lookup(PDFName.of('Names'));
  assert.ok(names, '/Names phải còn vì còn /Dests');
  assert.equal(names.has(PDFName.of('Dests')), true);
  assert.equal(names.has(PDFName.of('EmbeddedFiles')), false);
});

test('đếm tệp trong cây tên có /Kids', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 'kids.pdf');
  const doc = await PDFDocument.create();
  doc.addPage([200, 300]);
  const spec = name => doc.context.obj({ Type: 'Filespec', F: PDFString.of(name) });
  const leafA = doc.context.obj({
    Names: [
      PDFHexString.fromText('a.txt'), doc.context.register(spec('a.txt')),
      PDFHexString.fromText('b.txt'), doc.context.register(spec('b.txt')),
    ],
  });
  const leafB = doc.context.obj({
    Names: [PDFHexString.fromText('c.txt'), doc.context.register(spec('c.txt'))],
  });
  const root = doc.context.obj({
    Kids: [doc.context.register(leafA), doc.context.register(leafB)],
  });
  doc.catalog.set(PDFName.of('Names'), doc.context.obj({
    EmbeddedFiles: doc.context.register(root),
  }));
  fs.writeFileSync(file, await doc.save());

  const r = await metadataTool(ctxFor(file, dir, {
    removeInfo: false, removeXmp: false, removeAttachments: true,
  }));
  assert.equal(r.stats.removed.attachments, 3);
  const outDoc = await loadOutput(r.outputs[0].path);
  assert.equal(outDoc.catalog.has(PDFName.of('Names')), false);
});

// Tạo Filespec + EmbeddedFile để gắn vào catalog /AF (không qua cây tên).
function makeFilespec(doc, name, payload) {
  const embedded = doc.context.stream(payload, { Type: 'EmbeddedFile' });
  const spec = doc.context.obj({
    Type: 'Filespec',
    F: PDFString.of(name),
    EF: { F: doc.context.register(embedded) },
  });
  return doc.context.register(spec);
}

test('chỉ có /AF ở catalog: vẫn xoá, đếm và giữ các mục /Names khác', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 'af-only.pdf');
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.addPage([200, 300]);
  const spec = makeFilespec(doc, 'af-only.txt', AF_MARKER);
  doc.catalog.set(PDFName.of('AF'), doc.context.obj([spec]));
  // /Dests hợp lệ (đích trang /Fit) để qpdf --check không cảnh báo cây tên rỗng.
  doc.catalog.set(PDFName.of('Names'), doc.context.obj({
    Dests: doc.context.obj({
      Names: [
        PDFHexString.fromText('dest-1'),
        doc.context.obj([doc.getPage(0).ref, PDFName.of('Fit')]),
      ],
    }),
  }));
  fs.writeFileSync(file, await doc.save());

  const r = await metadataTool(ctxFor(file, dir, {
    removeInfo: false, removeXmp: false, removeAttachments: true,
  }));
  assert.deepEqual(r.stats.removed, { info: false, xmp: false, attachments: 1 });

  const out = r.outputs[0].path;
  const outDoc = await loadOutput(out);
  assert.equal(outDoc.catalog.has(PDFName.of('AF')), false, '/AF phải bị xoá');
  const names = outDoc.catalog.lookup(PDFName.of('Names'));
  assert.ok(names, '/Names phải còn vì còn /Dests');
  assert.equal(names.has(PDFName.of('Dests')), true, 'mục /Names không liên quan phải được giữ');
  assert.equal(fs.readFileSync(out).includes(Buffer.from(AF_MARKER)), false, 'payload AF không còn');
  const types = await objectTypes(out);
  assert.equal(types.includes('/Filespec'), false, 'không còn object Filespec mồ côi');
  assert.equal(types.includes('/EmbeddedFile'), false, 'không còn object EmbeddedFile mồ côi');
  await qpdf(['--check', out]);
});

test('catalog /AF có mục ngoài cây tên: xoá hết, đếm đủ, không đếm trùng', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 'af-mixed.pdf');
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.addPage([200, 300]);
  const inTree = makeFilespec(doc, 'in-tree.txt', 'SECRET-IN-TREE-PAYLOAD');
  const afOnly = makeFilespec(doc, 'af-only.txt', AF_MARKER);
  doc.catalog.set(PDFName.of('Names'), doc.context.obj({
    EmbeddedFiles: doc.context.obj({ Names: [PDFHexString.fromText('in-tree.txt'), inTree] }),
  }));
  doc.catalog.set(PDFName.of('AF'), doc.context.obj([inTree, afOnly]));
  fs.writeFileSync(file, await doc.save());

  const r = await metadataTool(ctxFor(file, dir, {
    removeInfo: false, removeXmp: false, removeAttachments: true,
  }));
  assert.deepEqual(r.stats.removed, { info: false, xmp: false, attachments: 2 });

  const out = r.outputs[0].path;
  const outDoc = await loadOutput(out);
  assert.equal(outDoc.catalog.has(PDFName.of('AF')), false);
  assert.equal(outDoc.catalog.has(PDFName.of('Names')), false);
  const outBytes = fs.readFileSync(out);
  assert.equal(outBytes.includes(Buffer.from(AF_MARKER)), false, 'payload AF-only không còn');
  assert.equal(outBytes.includes(Buffer.from('SECRET-IN-TREE-PAYLOAD')), false, 'payload cây tên không còn');
  const types = await objectTypes(out);
  assert.equal(types.includes('/Filespec'), false);
  assert.equal(types.includes('/EmbeddedFile'), false);
});

test('PDF chỉ có Info: XMP/đính kèm báo 0, Info bị xoá sạch', async t => {
  const dir = tempDir(t);
  const file = await makeRichPdf(path.join(dir, 'nguon.pdf'), {
    xmp: false, attachments: 0,
  });

  const r = await metadataTool(ctxFor(file, dir));
  assert.deepEqual(r.stats.removed, { info: true, xmp: false, attachments: 0 });
  const out = r.outputs[0].path;
  const doc = await loadOutput(out);
  assert.equal(doc.context.trailerInfo.Info, undefined, 'trailer không còn /Info');
  assert.equal(doc.getTitle(), undefined);
  assert.equal(doc.getKeywords(), undefined);
  const outBytes = fs.readFileSync(out);
  for (const marker of ['CreationDate', 'ModDate', '/Company', COMPANY_MARKER]) {
    assert.equal(outBytes.includes(Buffer.from(marker)), false, `không còn ${marker} trong file`);
  }
});

test('PDF không có Info: báo info:false, không tự tạo Info', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 'noinfo.pdf');
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.addPage([200, 300]);
  fs.writeFileSync(file, await doc.save());

  const r = await metadataTool(ctxFor(file, dir, {
    removeInfo: true, removeXmp: false, removeAttachments: false,
  }));
  assert.deepEqual(r.stats.removed, { info: false, xmp: false, attachments: 0 });
  const outDoc = await loadOutput(r.outputs[0].path);
  assert.equal(outDoc.context.trailerInfo.Info, undefined, 'không được tạo Info mới');
});

test('tắt cả ba tuỳ chọn báo INVALID_OPTIONS, không tạo output', async t => {
  const dir = tempDir(t);
  const file = await makeRichPdf(path.join(dir, 'nguon.pdf'));

  const ctx = ctxFor(file, dir, {
    removeInfo: false, removeXmp: false, removeAttachments: false,
  });
  await assert.rejects(
    metadataTool(ctx),
    e => e.code === 'INVALID_OPTIONS',
  );
  assert.equal(fs.existsSync(path.join(dir, 'nguon-xoa-metadata.pdf')), false);
  assert.deepEqual(fs.readdirSync(ctx.tempDir), [], 'không được ghi file tạm');
});

test('giá trị tuỳ chọn không phải boolean báo INVALID_OPTIONS', async t => {
  const dir = tempDir(t);
  const file = await makeRichPdf(path.join(dir, 'nguon.pdf'));

  await assert.rejects(
    metadataTool(ctxFor(file, dir, { removeInfo: 'true' })),
    e => e.code === 'INVALID_OPTIONS',
  );
  assert.equal(fs.existsSync(path.join(dir, 'nguon-xoa-metadata.pdf')), false);
});

test('không ghi đè: lần hai nhận tên (2), file đầu giữ nguyên', async t => {
  const dir = tempDir(t);
  const file = await makeRichPdf(path.join(dir, 'nguon.pdf'));

  const first = await metadataTool(ctxFor(file, dir));
  const firstPath = first.outputs[0].path;
  const before = fs.readFileSync(firstPath);

  const second = await metadataTool(ctxFor(file, dir));
  assert.equal(path.basename(second.outputs[0].path), 'nguon-xoa-metadata (2).pdf');
  assert.deepEqual(fs.readFileSync(firstPath), before, 'file đầu tiên phải giữ nguyên');
});

test('PDF đã mã hoá báo PASSWORD_REQUIRED, không tạo output', async t => {
  const dir = tempDir(t);
  const plain = await makeRichPdf(path.join(dir, 'plain.pdf'));
  const locked = await lockedCopy(plain, dir);

  await assert.rejects(
    metadataTool(ctxFor(locked, dir)),
    e => e.code === 'PASSWORD_REQUIRED',
  );
  assert.equal(fs.existsSync(path.join(dir, 'locked-xoa-metadata.pdf')), false);
});

test('PDF hỏng báo INVALID_FILE, không tạo output và không lộ đường dẫn', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 'broken.pdf');
  fs.writeFileSync(file, 'không phải PDF');

  await assert.rejects(
    metadataTool(ctxFor(file, dir)),
    e => e.code === 'INVALID_FILE' && e.message === 'Không đọc được PDF.'
      && !e.message.includes(dir),
  );
  assert.equal(fs.existsSync(path.join(dir, 'broken-xoa-metadata.pdf')), false);
});

test('huỷ trước khi xử lý không để lại file đầu ra', async t => {
  const dir = tempDir(t);
  const file = await makeRichPdf(path.join(dir, 'nguon.pdf'));
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    metadataTool(ctxFor(file, dir, {}, { signal: controller.signal })),
    e => e.name === 'AbortError',
  );
  assert.equal(fs.existsSync(path.join(dir, 'nguon-xoa-metadata.pdf')), false);
});
