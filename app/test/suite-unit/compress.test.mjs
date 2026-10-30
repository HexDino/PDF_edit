import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const {
  PDFDocument, PDFName, PDFNumber, PDFRawStream, degrees, decodePDFRawStream,
} = require('pdf-lib');
const { compressTool } = require('../../suite/pdfops/compress.js');
const { runProcess } = require('../../suite/util/spawn.js');
const { binaryPath } = require('../../suite/util/paths.js');

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SIG_PHOTO = fs.readFileSync(path.join(APP_ROOT, 'test', 'sig-photo.jpg'));
const qpdf = (args, opts = {}) => runProcess(
  binaryPath('qpdf.exe', { appRoot: APP_ROOT, isPackaged: false }),
  args, opts,
);

// PNG 1×1 hợp lệ để render giả trả về.
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n0kAAAAASUVORK5CYII=',
  'base64',
);

async function makePdf(file, pages = 3) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([200 + i * 10, 300]);
    page.drawText(`Trang ${i + 1}`, { x: 20, y: 250, size: 14 });
  }
  fs.writeFileSync(file, await doc.save());
}

function ctxFor(file, dir, overrides = {}) {
  const tempDir = fs.mkdtempSync(path.join(dir, 'tmp-'));
  const ctx = {
    files: [file], tempDir, outputDir: dir, signal: new AbortController().signal,
    options: { mode: 'lossless', pages: '', dpi: 150, format: 'png', quality: 80, ...overrides },
    progress() {}, log() {},
    qpdf: args => qpdf(args),
    render: {
      pdfToImages: async ({ pages, outDir, signal }) => pages.map(n => {
        signal?.throwIfAborted?.();
        const p = path.join(outDir, `render-${n}.png`);
        fs.writeFileSync(p, PNG_1x1);
        return { page: n, path: p };
      }),
    },
  };
  return ctx;
}

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsp-compress-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function pageContent(doc, page) {
  const contents = page.node.Contents();
  if (!contents) return '';
  const refs = contents.asArray ? contents.asArray() : [contents];
  let text = '';
  for (const ref of refs) {
    const stream = doc.context.lookup(ref);
    if (!(stream instanceof PDFRawStream)) continue;
    text += Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');
  }
  return text;
}

function pageImageSize(doc, page) {
  const resources = page.node.Resources();
  const xobjects = resources && resources.lookup(PDFName.of('XObject'));
  if (!xobjects) return null;
  for (const [, ref] of xobjects.entries()) {
    const stream = doc.context.lookup(ref);
    const dict = stream && stream.dict;
    if (!dict) continue;
    const width = dict.get(PDFName.of('Width'));
    const height = dict.get(PDFName.of('Height'));
    if (width && height) return { width: width.asNumber(), height: height.asNumber() };
  }
  return null;
}

// pdf-lib mã hoá chuỗi thành hex trong content stream.
function pageShows(doc, page, text) {
  const hex = Buffer.from(text, 'latin1').toString('hex').toUpperCase();
  return pageContent(doc, page).toUpperCase().includes(hex);
}

test('lossless tạo <base>-nen.pdf, giữ số trang, báo before/after', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 'a.pdf');
  await makePdf(file, 3);
  const ctx = ctxFor(file, dir);
  const beforeBytes = fs.statSync(file).size;

  const r = await compressTool(ctx);

  assert.equal(r.outputs.length, 1);
  const out = r.outputs[0].path;
  assert.equal(path.basename(out), 'a-nen.pdf');
  assert.equal(path.dirname(path.resolve(out)), path.resolve(dir));
  const doc = await PDFDocument.load(fs.readFileSync(out));
  assert.equal(doc.getPageCount(), 3);
  assert.equal(r.stats.mode, 'lossless');
  assert.equal(r.stats.beforeBytes, beforeBytes);
  assert.equal(r.stats.afterBytes, fs.statSync(out).size);
  assert.ok(r.stats.beforeBytes > 0 && r.stats.afterBytes > 0);
  assert.equal(Number.isInteger(r.stats.savedPercent), true);
  assert.equal(
    r.stats.savedPercent,
    Math.round((1 - r.stats.afterBytes / r.stats.beforeBytes) * 100),
    'savedPercent phải đúng công thức từ số byte thực tế',
  );
  assert.equal(r.stats.rasterPages, 0);
  assert.deepEqual(r.errors, []);
  assert.equal(fs.existsSync(path.join(ctx.tempDir, 'compressed.pdf')), false, 'temp phải được dọn sau khi xuất bản');
});

test('lossless không ghi đè: lần hai nhận (2), file đầu giữ bytes', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 'a.pdf');
  await makePdf(file, 2);

  const first = await compressTool(ctxFor(file, dir));
  const firstBytes = fs.readFileSync(first.outputs[0].path);
  const second = await compressTool(ctxFor(file, dir));

  assert.equal(path.basename(second.outputs[0].path), 'a-nen (2).pdf');
  assert.deepEqual(fs.readFileSync(first.outputs[0].path), firstBytes, 'file đầu phải giữ nguyên');
});

test('raster chỉ thay trang chọn, trang khác giữ nguyên, cảnh báo TEXT_LAYER_REMOVED', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 'a.pdf');
  await makePdf(file, 3);
  const ctx = ctxFor(file, dir, { mode: 'raster', pages: '2' });
  const baseRender = ctx.render.pdfToImages;
  let seen = null;
  ctx.render.pdfToImages = async args => { seen = args; return baseRender(args); };

  const r = await compressTool(ctx);

  const outDoc = await PDFDocument.load(fs.readFileSync(r.outputs[0].path));
  assert.equal(outDoc.getPageCount(), 3);
  // Trang không chọn giữ nguyên nội dung chữ; trang chọn thành ảnh.
  assert.equal(pageShows(outDoc, outDoc.getPage(0), 'Trang 1'), true);
  assert.equal(pageShows(outDoc, outDoc.getPage(2), 'Trang 3'), true);
  assert.equal(pageShows(outDoc, outDoc.getPage(1), 'Trang 2'), false);
  assert.deepEqual(pageImageSize(outDoc, outDoc.getPage(1)), { width: 1, height: 1 });
  assert.equal(pageImageSize(outDoc, outDoc.getPage(0)), null);
  assert.equal(pageImageSize(outDoc, outDoc.getPage(2)), null);
  assert.deepEqual(outDoc.getPages().map(p => Math.round(p.getWidth())), [200, 210, 220]);

  assert.equal(r.stats.mode, 'raster');
  assert.equal(r.stats.rasterPages, 1);
  assert.equal(Number.isInteger(r.stats.savedPercent), true);
  assert.equal(r.stats.afterBytes, fs.statSync(r.outputs[0].path).size);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].code, 'TEXT_LAYER_REMOVED');
  assert.equal(r.errors[0].file, file);
  assert.equal(r.errors[0].message, 'Trang đã được raster hoá; lớp chữ trên các trang đó không còn.');

  // Render nhận đúng file/trang/DPI/định dạng/chất lượng/thư mục tạm/signal.
  assert.equal(seen.filePath, file);
  assert.deepEqual(seen.pages, [2]);
  assert.equal(seen.dpi, 150);
  assert.equal(seen.format, 'png');
  assert.equal(seen.quality, 0.8);
  assert.equal(seen.outDir, ctx.tempDir);
  assert.equal(seen.signal, ctx.signal);
  assert.equal(typeof seen.progress, 'function');
  assert.deepEqual(fs.readdirSync(ctx.tempDir), [], 'tempDir phải sạch sau khi xuất bản');
});

test('raster dùng vùng hiển thị CropBox và góc xoay', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 'c.pdf');
  const src = await PDFDocument.create();
  src.addPage([200, 300]).drawText('Trang 1', { x: 20, y: 250, size: 14 });
  const rotated = src.addPage([200, 300]);
  rotated.setCropBox(10, 20, 140, 240); // CropBox [10 20 150 260]
  rotated.setRotation(degrees(90));
  rotated.drawText('Trang 2', { x: 20, y: 250, size: 14 });
  fs.writeFileSync(file, await src.save());

  const r = await compressTool(ctxFor(file, dir, { mode: 'raster', pages: '2' }));
  const outDoc = await PDFDocument.load(fs.readFileSync(r.outputs[0].path));
  const page1 = outDoc.getPage(0);
  const page2 = outDoc.getPage(1);
  assert.deepEqual([page1.getWidth(), page1.getHeight()], [200, 300]);
  assert.equal(((page1.getRotation().angle % 360) + 360) % 360, 0);
  // CropBox 140×240, xoay 90 → khung nhìn 240×140; trang mới không còn xoay.
  assert.deepEqual([page2.getWidth(), page2.getHeight()], [240, 140]);
  assert.equal(((page2.getRotation().angle % 360) + 360) % 360, 0);
});

test('raster giữ nguyên CropBox và góc xoay của trang không chọn', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 'keep.pdf');
  const src = await PDFDocument.create();
  const kept = src.addPage([200, 300]);
  kept.setCropBox(10, 20, 140, 240);
  kept.setRotation(degrees(90));
  kept.drawText('Kept page', { x: 20, y: 250, size: 14 });
  src.addPage([220, 320]).drawText('Raster', { x: 20, y: 270, size: 14 });
  fs.writeFileSync(file, await src.save());

  const r = await compressTool(ctxFor(file, dir, { mode: 'raster', pages: '2' }));
  const outDoc = await PDFDocument.load(fs.readFileSync(r.outputs[0].path));
  const outKept = outDoc.getPage(0);
  assert.deepEqual(outKept.getCropBox(), { x: 10, y: 20, width: 140, height: 240 });
  assert.equal(((outKept.getRotation().angle % 360) + 360) % 360, 90);
  assert.deepEqual([outKept.getWidth(), outKept.getHeight()], [200, 300]);
});

test('raster nhân kích thước trang theo /UserUnit', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 'unit.pdf');
  const src = await PDFDocument.create();
  const page = src.addPage([200, 300]);
  page.node.set(PDFName.of('UserUnit'), src.context.register(PDFNumber.of(2)));
  page.drawText('Trang 1', { x: 20, y: 250, size: 14 });
  fs.writeFileSync(file, await src.save());

  const r = await compressTool(ctxFor(file, dir, { mode: 'raster', pages: '1' }));
  const outDoc = await PDFDocument.load(fs.readFileSync(r.outputs[0].path));
  assert.deepEqual([outDoc.getPage(0).getWidth(), outDoc.getPage(0).getHeight()], [400, 600]);
});

test('raster từ chối /UserUnit <= 0 bằng INVALID_FILE', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 'unit-bad.pdf');
  const src = await PDFDocument.create();
  const page = src.addPage([200, 300]);
  page.node.set(PDFName.of('UserUnit'), PDFNumber.of(0));
  page.drawText('Trang 1', { x: 20, y: 250, size: 14 });
  fs.writeFileSync(file, await src.save());

  await assert.rejects(
    compressTool(ctxFor(file, dir, { mode: 'raster', pages: '1' })),
    e => e.code === 'INVALID_FILE' && !e.message.includes(dir),
  );
  assert.equal(fs.existsSync(path.join(dir, 'unit-bad-nen.pdf')), false);
});

test('raster không ghi đè: lần hai nhận (2)', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 'a.pdf');
  await makePdf(file, 2);
  const options = { mode: 'raster', pages: '1' };

  const first = await compressTool(ctxFor(file, dir, options));
  const firstBytes = fs.readFileSync(first.outputs[0].path);
  const second = await compressTool(ctxFor(file, dir, options));

  assert.equal(path.basename(second.outputs[0].path), 'a-nen (2).pdf');
  assert.deepEqual(fs.readFileSync(first.outputs[0].path), firstBytes, 'file đầu phải giữ nguyên');
});

test('raster JPEG nhúng ảnh thật và dọn tempDir sau xuất bản', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 'photo.pdf');
  await makePdf(file, 2);
  const ctx = ctxFor(file, dir, { mode: 'raster', pages: '1', format: 'jpg' });
  ctx.render.pdfToImages = async ({ pages, outDir, signal }) => pages.map(n => {
    signal?.throwIfAborted?.();
    const p = path.join(outDir, `render-${n}.jpg`);
    fs.writeFileSync(p, SIG_PHOTO);
    return { page: n, path: p };
  });

  const r = await compressTool(ctx);

  const outDoc = await PDFDocument.load(fs.readFileSync(r.outputs[0].path));
  assert.deepEqual(pageImageSize(outDoc, outDoc.getPage(0)), { width: 1200, height: 600 });
  assert.equal(pageShows(outDoc, outDoc.getPage(1), 'Trang 2'), true);
  assert.equal(r.stats.rasterPages, 1);
  assert.deepEqual(fs.readdirSync(ctx.tempDir), [], 'tempDir phải sạch sau khi xuất bản');
});

test('raster dọn ảnh tạm khi kiểm tra render thất bại', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 'a.pdf');
  await makePdf(file, 2);
  const ctx = ctxFor(file, dir, { mode: 'raster', pages: '1' });
  // Trả sai trang kèm file thật: assertRendered phải ném lỗi và catch phải xoá file.
  ctx.render.pdfToImages = async ({ outDir }) => {
    const p = path.join(outDir, 'orphan.png');
    fs.writeFileSync(p, PNG_1x1);
    return [{ page: 2, path: p }];
  };

  await assert.rejects(
    compressTool(ctx),
    e => e.code === 'RENDER_FAILED' && !e.message.includes(dir),
  );
  assert.equal(fs.existsSync(path.join(ctx.tempDir, 'orphan.png')), false);
  assert.deepEqual(fs.readdirSync(ctx.tempDir), [], 'tempDir phải sạch sau lỗi render');
});

test('PDF mã hoá báo PASSWORD_REQUIRED, PDF hỏng báo INVALID_FILE', async t => {
  const dir = tempDir(t);
  const plain = path.join(dir, 'plain.pdf');
  await makePdf(plain, 1);
  const locked = path.join(dir, 'locked.pdf');
  await qpdf(['--encrypt', 'pw', 'owner', '256', '--', plain, locked]);

  for (const options of [{}, { mode: 'raster', pages: '' }]) {
    await assert.rejects(
      compressTool(ctxFor(locked, dir, options)),
      e => e.code === 'PASSWORD_REQUIRED' && !e.message.includes(dir),
    );
    assert.equal(fs.existsSync(path.join(dir, 'locked-nen.pdf')), false);
  }

  const broken = path.join(dir, 'broken.pdf');
  fs.writeFileSync(broken, 'không phải PDF');
  await assert.rejects(
    compressTool(ctxFor(broken, dir)),
    e => e.code === 'INVALID_FILE' && !e.message.includes(dir),
  );
  await assert.rejects(
    compressTool(ctxFor(broken, dir, { mode: 'raster', pages: '' })),
    e => e.code === 'INVALID_FILE' && !e.message.includes(dir),
  );
  assert.equal(fs.existsSync(path.join(dir, 'broken-nen.pdf')), false);
});

test('pre-abort không tạo output', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 'a.pdf');
  await makePdf(file, 2);
  const controller = new AbortController();
  controller.abort();
  const ctx = ctxFor(file, dir);
  ctx.signal = controller.signal;

  await assert.rejects(
    compressTool(ctx),
    e => e.name === 'AbortError' || e.code === 'CANCELLED',
  );
  assert.equal(fs.existsSync(path.join(dir, 'a-nen.pdf')), false);
});

test('options sai bị từ chối khi gọi trực tiếp, không tạo output', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 'a.pdf');
  await makePdf(file, 2);

  for (const options of [
    { mode: 'lossy' },
    { dpi: 1000 },
    { dpi: 71 },
    { format: 'webp' },
    { quality: 59 },
    { unknownKey: 1 },
  ]) {
    const ctx = ctxFor(file, dir, options);
    await assert.rejects(
      compressTool(ctx),
      e => e.code === 'INVALID_OPTIONS' && !e.message.includes(dir),
    );
    assert.equal(fs.existsSync(path.join(dir, 'a-nen.pdf')), false);
  }
});

test('options null/array/không phải object bị từ chối, undefined dùng mặc định', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 'a.pdf');
  await makePdf(file, 2);

  for (const options of [null, [], 'lossless', 42, true]) {
    const ctx = ctxFor(file, dir);
    ctx.options = options;
    await assert.rejects(
      compressTool(ctx),
      e => e.code === 'INVALID_OPTIONS' && !e.message.includes(dir),
    );
    assert.equal(fs.existsSync(path.join(dir, 'a-nen.pdf')), false);
  }

  const ctx = ctxFor(file, dir);
  ctx.options = undefined;
  const r = await compressTool(ctx);
  assert.equal(path.basename(r.outputs[0].path), 'a-nen.pdf');
});

test('abort sau qpdf dọn file tạm lossless', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 'a.pdf');
  await makePdf(file, 2);
  const controller = new AbortController();
  const ctx = ctxFor(file, dir);
  ctx.signal = controller.signal;
  ctx.qpdf = async args => {
    fs.copyFileSync(file, args[args.length - 1]);
    controller.abort();
  };

  await assert.rejects(
    compressTool(ctx),
    e => e.name === 'AbortError' || e.code === 'CANCELLED',
  );
  assert.equal(fs.existsSync(path.join(ctx.tempDir, 'compressed.pdf')), false, 'file tạm phải được xoá');
  assert.equal(fs.existsSync(path.join(dir, 'a-nen.pdf')), false);
});

test('qpdf exit 3 với file dùng được vẫn xuất bản', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 'a.pdf');
  await makePdf(file, 2);
  const ctx = ctxFor(file, dir);
  ctx.qpdf = async args => {
    fs.copyFileSync(file, args[args.length - 1]);
    throw Object.assign(new Error('warning'), { exitCode: 3, stderr: 'WARNING: minor' });
  };

  const r = await compressTool(ctx);
  assert.equal(path.basename(r.outputs[0].path), 'a-nen.pdf');
  assert.equal(r.stats.beforeBytes, fs.statSync(file).size);
});

test('qpdf không tạo file → INTERNAL, không lộ đường dẫn', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 'a.pdf');
  await makePdf(file, 2);
  const ctx = ctxFor(file, dir);
  ctx.qpdf = async () => ({ code: 0, stdout: '', stderr: '' });

  await assert.rejects(
    compressTool(ctx),
    e => e.code === 'INTERNAL' && !e.message.includes(dir),
  );
  assert.equal(fs.existsSync(path.join(dir, 'a-nen.pdf')), false);
});

test('thiếu qpdf → BINARY_MISSING, không tạo output', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 'a.pdf');
  await makePdf(file, 2);
  const ctx = ctxFor(file, dir);
  ctx.qpdf = async () => {
    throw Object.assign(new Error('spawn qpdf ENOENT'), { code: 'ENOENT' });
  };

  await assert.rejects(
    compressTool(ctx),
    e => e.code === 'BINARY_MISSING' && !e.message.includes(dir),
  );
  assert.equal(fs.existsSync(path.join(dir, 'a-nen.pdf')), false);
});
