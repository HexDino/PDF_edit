import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { PDFDocument, PDFName, decodePDFRawStream } = require('pdf-lib');
const { imagesTool } = require('../../suite/pdfops/images-pdf.js');
const { ToolError } = require('../../suite/errors.js');

const TEST_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SIG_PHOTO = path.join(TEST_DIR, 'sig-photo.jpg');
const TINY_WEBP = path.join(TEST_DIR, 'tiny.webp');
// PNG 60×90 sinh sẵn (base64) để kiểm tra thứ tự và khổ tự động.
const PNG_60x90 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAADwAAABaCAIAAABrM6JiAAAAqElEQVR4nNXOMREAIBDAsFIhzPhXgSw8/MI1CrLuPtRIkARJkARJkARJkARJkARJkARJkARJkARJkARJkARJkARJkARJkARJkARJkARJkARJkARJkARJkARJkARJkARJkARJkARJkARJkARJkARJkARJkARJkARJkARJkARJkARJkARJkARJkARJkAT5OzDxAL8tAcI6DFvWAAAAAElFTkSuQmCC',
  'base64',
);
const MM = 72 / 25.4;
const A4 = { width: 595.28, height: 841.89 };
const A3 = { width: 841.89, height: 1190.55 };
const LETTER = { width: 612, height: 792 };

const near = (actual, expected, label, tolerance = 0.01) => {
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `${label}: mong đợi ${expected}, nhận ${actual}`,
  );
};

function envFor(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsp-images-'));
  const src = path.join(root, 'src');
  const out = path.join(root, 'out');
  const tmp = path.join(root, 'tmp');
  fs.mkdirSync(src);
  fs.mkdirSync(out);
  fs.mkdirSync(tmp);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, src, out, tmp };
}

function copyFixture(name, source, dir) {
  const dest = path.join(dir, name);
  fs.copyFileSync(source, dest);
  return dest;
}

function writePng(dir, name = 'tall.png') {
  const dest = path.join(dir, name);
  fs.writeFileSync(dest, PNG_60x90);
  return dest;
}

function ctxFor(files, env, options = {}, overrides = {}) {
  return {
    files,
    tempDir: env.tmp,
    outputDir: env.out,
    signal: new AbortController().signal,
    options: { pageSize: 'A4', orientation: 'auto', margin: 10, ...options },
    progress() {},
    log() {},
    image: null,
    ...overrides,
  };
}

async function loadDoc(file) {
  return PDFDocument.load(fs.readFileSync(file));
}

/** Ảnh nhúng trong trang: kích thước pixel của XObject ảnh. */
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

function pageContent(doc, page) {
  const contents = page.node.Contents();
  if (!contents) return '';
  const refs = contents.asArray ? contents.asArray() : [contents];
  let text = '';
  for (const ref of refs) {
    const stream = doc.context.lookup(ref);
    text += Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');
  }
  return text;
}

/** Vị trí/kích thước ảnh do page.drawImage sinh ra trong content stream. */
function drawnImage(doc, page) {
  const match = /1 0 0 1 (-?[\d.]+) (-?[\d.]+) cm\s+1 0 0 1 0 0 cm\s+([\d.]+) 0 0 ([\d.]+) 0 0 cm/
    .exec(pageContent(doc, page));
  return match
    ? { x: Number(match[1]), y: Number(match[2]), width: Number(match[3]), height: Number(match[4]) }
    : null;
}

function outputFiles(env) {
  return fs.readdirSync(env.out).sort();
}

test('JPG + PNG: 2 trang, đúng thứ tự, A4 tự chọn hướng theo ảnh', async t => {
  const env = envFor(t);
  const jpg = copyFixture('photo.jpg', SIG_PHOTO, env.src);
  const png = writePng(env.src);
  const progress = [];
  const ctx = ctxFor([jpg, png], env, {}, {
    progress(phase, current, total) { progress.push({ phase, current, total }); },
  });

  const result = await imagesTool(ctx);
  assert.equal(result.outputs.length, 1);
  assert.equal(path.basename(result.outputs[0].path), 'photo-anh.pdf');
  assert.equal(path.dirname(path.resolve(result.outputs[0].path)), path.resolve(env.out));
  assert.equal(result.stats.pages, 2);
  assert.deepEqual(
    progress.filter(p => p.current > 0).map(p => `${p.phase}:${p.current}/${p.total}`),
    ['processing:1/2', 'processing:2/2', 'done:2/2'],
  );

  const doc = await loadDoc(result.outputs[0].path);
  assert.equal(doc.getPageCount(), 2);
  const [first, second] = doc.getPages();
  // JPG 1200×600 (ngang) -> A4 ngang; PNG 60×90 (dọc) -> A4 dọc.
  near(first.getWidth(), A4.height, 'trang 1 rộng');
  near(first.getHeight(), A4.width, 'trang 1 cao');
  near(second.getWidth(), A4.width, 'trang 2 rộng');
  near(second.getHeight(), A4.height, 'trang 2 cao');
  assert.deepEqual(pageImageSize(doc, first), { width: 1200, height: 600 });
  assert.deepEqual(pageImageSize(doc, second), { width: 60, height: 90 });
  assert.deepEqual(outputFiles(env), ['photo-anh.pdf']);
});

test('A4/A3/Letter đúng điểm và đổi hướng dọc/ngang', async t => {
  const env = envFor(t);
  const png = writePng(env.src);
  const cases = [
    ['A4', A4],
    ['A3', A3],
    ['Letter', LETTER],
  ];

  for (const [pageSize, size] of cases) {
    const portrait = await imagesTool(ctxFor([png], env, { pageSize, orientation: 'portrait' }));
    const pDoc = await loadDoc(portrait.outputs[0].path);
    near(pDoc.getPage(0).getWidth(), size.width, `${pageSize} dọc rộng`);
    near(pDoc.getPage(0).getHeight(), size.height, `${pageSize} dọc cao`);

    const landscape = await imagesTool(ctxFor([png], env, { pageSize, orientation: 'landscape' }));
    const lDoc = await loadDoc(landscape.outputs[0].path);
    near(lDoc.getPage(0).getWidth(), size.height, `${pageSize} ngang rộng`);
    near(lDoc.getPage(0).getHeight(), size.width, `${pageSize} ngang cao`);
  }
});

test('khổ tự động = ảnh + lề; ảnh phủ đúng vùng in', async t => {
  const env = envFor(t);
  const png = writePng(env.src);
  const margin = 10;
  const result = await imagesTool(ctxFor([png], env, { pageSize: 'auto', margin }));
  const doc = await loadDoc(result.outputs[0].path);
  const page = doc.getPage(0);
  const marginPt = margin * MM;
  near(page.getWidth(), 60 + 2 * marginPt, 'auto rộng');
  near(page.getHeight(), 90 + 2 * marginPt, 'auto cao');

  const drawn = drawnImage(doc, page);
  assert.ok(drawn, 'phải có lệnh vẽ ảnh');
  near(drawn.width, 60, 'ảnh rộng');
  near(drawn.height, 90, 'ảnh cao');
  near(drawn.x, marginPt, 'ảnh x');
  near(drawn.y, marginPt, 'ảnh y');
});

test('khổ tự động đổi hướng khi orientation chỉ định', async t => {
  const env = envFor(t);
  const png = writePng(env.src);
  const result = await imagesTool(ctxFor([png], env, { pageSize: 'auto', orientation: 'landscape', margin: 5 }));
  const doc = await loadDoc(result.outputs[0].path);
  const page = doc.getPage(0);
  near(page.getWidth(), 90 + 2 * 5 * MM, 'auto ngang rộng');
  near(page.getHeight(), 60 + 2 * 5 * MM, 'auto ngang cao');

  const drawn = drawnImage(doc, page);
  // Vùng in sau khi đổi hướng là 90×60 pt; ảnh 60×90 vừa theo chiều cao.
  near(drawn.width, 40, 'ảnh rộng');
  near(drawn.height, 60, 'ảnh cao');
});

test('lề mm thu nhỏ ảnh và canh giữa trong vùng in', async t => {
  const env = envFor(t);
  const png = writePng(env.src);

  const noMargin = await imagesTool(ctxFor([png], env, { pageSize: 'A4', orientation: 'portrait', margin: 0 }));
  const noMarginDoc = await loadDoc(noMargin.outputs[0].path);
  const noMarginDrawn = drawnImage(noMarginDoc, noMarginDoc.getPage(0));

  const margin = 20;
  const marginPt = margin * MM;
  const withMargin = await imagesTool(ctxFor([png], env, { pageSize: 'A4', orientation: 'portrait', margin }));
  const doc = await loadDoc(withMargin.outputs[0].path);
  const page = doc.getPage(0);
  const drawn = drawnImage(doc, page);
  assert.ok(drawn.width < noMarginDrawn.width, 'lề lớn phải làm ảnh nhỏ hơn');

  const printableW = A4.width - 2 * marginPt;
  const printableH = A4.height - 2 * marginPt;
  assert.ok(drawn.width <= printableW + 0.01 && drawn.height <= printableH + 0.01, 'ảnh phải nằm trong vùng in');
  near(drawn.x, marginPt + (printableW - drawn.width) / 2, 'canh giữa ngang');
  near(drawn.y, marginPt + (printableH - drawn.height) / 2, 'canh giữa dọc');
});

test('không ghi đè: lần hai nhận tên (2), file đầu giữ nguyên', async t => {
  const env = envFor(t);
  const png = writePng(env.src);

  const first = await imagesTool(ctxFor([png], env));
  const firstFile = first.outputs[0].path;
  const firstBytes = fs.readFileSync(firstFile);
  const second = await imagesTool(ctxFor([png], env));

  assert.equal(path.basename(firstFile), 'tall-anh.pdf');
  assert.equal(path.basename(second.outputs[0].path), 'tall-anh (2).pdf');
  assert.deepEqual(fs.readFileSync(firstFile), firstBytes, 'file lần đầu phải giữ nguyên');
  assert.equal((await loadDoc(second.outputs[0].path)).getPageCount(), 1);
});

test('ảnh hỏng báo INVALID_FILE, không tạo file kết quả', async t => {
  const env = envFor(t);
  const broken = ['broken.jpg', 'broken.png'].map(name => {
    const file = path.join(env.src, name);
    fs.writeFileSync(file, 'không phải ảnh');
    return file;
  });
  for (const file of broken) {
    await assert.rejects(
      imagesTool(ctxFor([file], env)),
      e => e.code === 'INVALID_FILE' && !e.message.includes(env.root),
    );
  }
  assert.deepEqual(outputFiles(env), []);
});

test('signal đã huỷ trước khi chạy: AbortError, không tạo file', async t => {
  const env = envFor(t);
  const png = writePng(env.src);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    imagesTool(ctxFor([png], env, {}, { signal: controller.signal })),
    e => e.name === 'AbortError',
  );
  assert.deepEqual(outputFiles(env), []);
});

test('huỷ sau ảnh đầu: dừng trước khi xuất PDF', async t => {
  const env = envFor(t);
  const jpg = copyFixture('photo.jpg', SIG_PHOTO, env.src);
  const png = writePng(env.src);
  const controller = new AbortController();
  let reported = 0;
  const ctx = ctxFor([jpg, png], env, {}, {
    signal: controller.signal,
    progress() { if (++reported === 1) controller.abort(); },
  });
  await assert.rejects(imagesTool(ctx), e => e.name === 'AbortError');
  assert.deepEqual(outputFiles(env), []);
});

test('WebP đi qua ctx.image.toPng rồi nhúng PNG', async t => {
  const env = envFor(t);
  const webp = copyFixture('photo.webp', TINY_WEBP, env.src);
  const pngPath = path.join(env.tmp, 'converted.png');
  fs.writeFileSync(pngPath, PNG_60x90);
  let convertedFrom = null;
  const image = {
    async toPng(filePath) {
      convertedFrom = filePath;
      return { path: pngPath, width: 60, height: 90 };
    },
  };

  const result = await imagesTool(ctxFor([webp], env, { pageSize: 'auto', margin: 0 }, { image }));
  assert.equal(convertedFrom, webp, 'phải chuyển đúng file WebP');
  const doc = await loadDoc(result.outputs[0].path);
  const page = doc.getPage(0);
  near(page.getWidth(), 60, 'trang WebP rộng');
  near(page.getHeight(), 90, 'trang WebP cao');
  assert.deepEqual(pageImageSize(doc, page), { width: 60, height: 90 });
  assert.deepEqual(outputFiles(env), ['photo-anh.pdf']);
});

test('WebP lỗi giải mã giữ mã INVALID_FILE', async t => {
  const env = envFor(t);
  const webp = copyFixture('photo.webp', TINY_WEBP, env.src);
  const image = {
    async toPng() { throw new ToolError('INVALID_FILE', 'Không đọc được ảnh.'); },
  };
  await assert.rejects(
    imagesTool(ctxFor([webp], env, {}, { image })),
    e => e.code === 'INVALID_FILE' && !e.message.includes(env.root),
  );
  assert.deepEqual(outputFiles(env), []);
});
