import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const {
  PDFDocument, PDFName, PDFString, PDFHexString,
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

/**
 * PDF nhiều metadata: Info đầy đủ, XMP không nén, và các tệp đính kèm.
 * pdf-lib attach tạo cả /Names/EmbeddedFiles lẫn /AF như người dùng thật.
 */
async function makeRichPdf(file, {
  info = true, xmp = true, attachments = 2, otherNames = false,
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
  }
  if (xmp) {
    const stream = doc.context.stream(XMP, { Type: 'Metadata', Subtype: 'XML' });
    doc.catalog.set(PDFName.of('Metadata'), doc.context.register(stream));
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

async function lockedCopy(src, dir, name = 'locked.pdf') {
  const locked = path.join(dir, name);
  await qpdf(['--encrypt', '--user-password=secret', '--owner-password=owner', '--bits=256', '--', src, locked]);
  return locked;
}

test('mặc định xoá Info, XMP và tệp đính kèm; báo cáo đúng số lượng', async t => {
  const dir = tempDir(t);
  const file = await makeRichPdf(path.join(dir, 'nguon.pdf'));

  const ctx = ctxFor(file, dir);
  const r = await metadataTool(ctx);
  assert.equal(r.outputs.length, 1);
  const out = r.outputs[0].path;
  assert.equal(path.basename(out), 'nguon-xoa-metadata.pdf');
  assert.equal(path.dirname(path.resolve(out)), path.resolve(dir));
  assert.deepEqual(r.stats.removed, { info: true, xmp: true, attachments: 2 });

  const doc = await loadOutput(out);
  assert.equal(doc.getPageCount(), 2, 'không được đổi số trang');
  for (const [label, value] of [
    ['title', doc.getTitle()], ['author', doc.getAuthor()], ['subject', doc.getSubject()],
    ['creator', doc.getCreator()], ['producer', doc.getProducer()], ['keywords', doc.getKeywords()],
  ]) {
    assert.equal(value, '', `Info ${label} phải rỗng`);
  }
  assert.equal(doc.catalog.has(PDFName.of('Metadata')), false, 'catalog không còn /Metadata');
  assert.equal(doc.catalog.has(PDFName.of('Names')), false, '/Names rỗng phải bị xoá');
  assert.equal(doc.catalog.has(PDFName.of('AF')), false, '/AF của tệp đính kèm phải bị bỏ');
  assert.equal(fs.readFileSync(out).includes(Buffer.from(XMP_MARKER)), false, 'XMP không còn trong file');

  const listed = await qpdf(['--list-attachments', out]);
  // qpdf in "has no embedded files" khi không còn tệp; chỉ cần không có tên tệp.
  assert.doesNotMatch(listed.stdout, /dinh-kem/);
  await qpdf(['--check', out]);
  assert.deepEqual(fs.readdirSync(ctx.tempDir), [], 'không để lại file tạm');
});

test('chỉ xoá Info: XMP và tệp đính kèm còn nguyên', async t => {
  const dir = tempDir(t);
  const file = await makeRichPdf(path.join(dir, 'nguon.pdf'));

  const r = await metadataTool(ctxFor(file, dir, {
    removeInfo: true, removeXmp: false, removeAttachments: false,
  }));
  assert.deepEqual(r.stats.removed, { info: true, xmp: false, attachments: 0 });

  const out = r.outputs[0].path;
  const doc = await loadOutput(out);
  assert.equal(doc.getTitle(), '');
  assert.equal(doc.getAuthor(), '');
  assert.equal(doc.catalog.has(PDFName.of('Metadata')), true, 'XMP phải được giữ');
  assert.equal(doc.catalog.has(PDFName.of('AF')), true, '/AF phải được giữ');
  const listed = await qpdf(['--list-attachments', out]);
  assert.match(listed.stdout, /dinh-kem-1\.txt/);
  assert.match(listed.stdout, /dinh-kem-2\.txt/);
});

test('chỉ xoá XMP: Info và tệp đính kèm còn nguyên', async t => {
  const dir = tempDir(t);
  const file = await makeRichPdf(path.join(dir, 'nguon.pdf'));

  const r = await metadataTool(ctxFor(file, dir, {
    removeInfo: false, removeXmp: true, removeAttachments: false,
  }));
  assert.deepEqual(r.stats.removed, { info: false, xmp: true, attachments: 0 });

  const out = r.outputs[0].path;
  const doc = await loadOutput(out);
  assert.equal(doc.getTitle(), 'Tài liệu mật');
  assert.equal(doc.getAuthor(), 'Nguyễn Văn A');
  assert.equal(doc.getProducer(), 'Máy in bí mật');
  assert.equal(doc.catalog.has(PDFName.of('Metadata')), false);
  assert.equal(fs.readFileSync(out).includes(Buffer.from(XMP_MARKER)), false);
  assert.equal(doc.catalog.has(PDFName.of('AF')), true, '/AF phải được giữ');
  const listed = await qpdf(['--list-attachments', out]);
  assert.match(listed.stdout, /dinh-kem-1\.txt/);
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

test('PDF chỉ có Info: XMP/đính kèm báo 0, Info vẫn rỗng', async t => {
  const dir = tempDir(t);
  const file = await makeRichPdf(path.join(dir, 'nguon.pdf'), {
    xmp: false, attachments: 0,
  });

  const r = await metadataTool(ctxFor(file, dir));
  assert.deepEqual(r.stats.removed, { info: true, xmp: false, attachments: 0 });
  const doc = await loadOutput(r.outputs[0].path);
  assert.equal(doc.getTitle(), '');
  assert.equal(doc.getKeywords(), '');
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
