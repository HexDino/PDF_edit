import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { PDFDocument } = require('pdf-lib');
const { splitPdf } = require('../../suite/pdfops/split.js');
const { runProcess } = require('../../suite/util/spawn.js');
const { binaryPath } = require('../../suite/util/paths.js');

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const qpdf = (args, opts = {}) => runProcess(
  binaryPath('qpdf.exe', { appRoot: APP_ROOT, isPackaged: false }),
  args, opts,
);

// Mỗi trang có bề rộng riêng để kiểm tra đúng trang được chép sang.
async function makePdf(file, widths) {
  const doc = await PDFDocument.create();
  for (const w of widths) doc.addPage([w, 200]);
  fs.writeFileSync(file, await doc.save());
}

function ctxFor(file, dir, options = {}, overrides = {}) {
  // Thư mục tạm nằm cạnh thư mục xuất để test kiểm tra được nội dung thư mục xuất.
  const tempDir = fs.mkdtempSync(path.join(path.dirname(dir), 'tmp-'));
  return {
    files: [file], tempDir, outputDir: dir, signal: new AbortController().signal,
    options, progress() {}, log() {}, ...overrides,
  };
}

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsp-split-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function pageWidths(file) {
  const doc = await PDFDocument.load(fs.readFileSync(file));
  return doc.getPages().map(p => Math.round(p.getWidth()));
}

test('tách theo khoảng trang: mỗi đoạn một file, đúng trang', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 's.pdf');
  await makePdf(file, [101, 102, 103, 104, 105]);
  const out = path.join(dir, 'out');
  fs.mkdirSync(out);
  const ctx = ctxFor(file, out, { mode: 'ranges', ranges: '1-2,4', every: 2 });

  const r = await splitPdf(ctx);
  assert.equal(path.basename(path.dirname(r.outputs[0].path)), 's-tach');
  assert.deepEqual(r.outputs.map(o => path.basename(o.path)), ['s-01.pdf', 's-02.pdf']);
  assert.deepEqual(await Promise.all(r.outputs.map(o => pageWidths(o.path))), [[101, 102], [104]]);
  assert.deepEqual(fs.readdirSync(out), ['s-tach']);
});

test('tách mỗi N trang: 5 trang, N=2 thành 3 file', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 's.pdf');
  await makePdf(file, [101, 102, 103, 104, 105]);
  const out = path.join(dir, 'out');
  fs.mkdirSync(out);

  const r = await splitPdf(ctxFor(file, out, { mode: 'every-n', every: 2 }));
  assert.deepEqual(r.outputs.map(o => path.basename(o.path)), ['s-01.pdf', 's-02.pdf', 's-03.pdf']);
  assert.deepEqual(await Promise.all(r.outputs.map(o => pageWidths(o.path))), [[101, 102], [103, 104], [105]]);
});

test('tách từng trang: 5 trang thành 5 file', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 's.pdf');
  await makePdf(file, [101, 102, 103, 104, 105]);
  const out = path.join(dir, 'out');
  fs.mkdirSync(out);

  const r = await splitPdf(ctxFor(file, out, { mode: 'each-page' }));
  assert.equal(r.outputs.length, 5);
  assert.deepEqual(await Promise.all(r.outputs.map(o => pageWidths(o.path))), [[101], [102], [103], [104], [105]]);
});

test('khoảng trang trống tách thành một file tất cả trang', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 's.pdf');
  await makePdf(file, [101, 102, 103]);
  const out = path.join(dir, 'out');
  fs.mkdirSync(out);

  const r = await splitPdf(ctxFor(file, out, { mode: 'ranges', ranges: '' }));
  assert.equal(r.outputs.length, 1);
  assert.deepEqual(await pageWidths(r.outputs[0].path), [101, 102, 103]);
});

test('không ghi đè thư mục cũ: lần hai nhận tên (2)', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 's.pdf');
  await makePdf(file, [101, 102]);
  const out = path.join(dir, 'out');
  fs.mkdirSync(out);
  const opts = { mode: 'ranges', ranges: '1,2' };

  const first = await splitPdf(ctxFor(file, out, opts));
  const firstFolder = path.dirname(first.outputs[0].path);
  const firstBytes = fs.readFileSync(first.outputs[0].path);
  const second = await splitPdf(ctxFor(file, out, opts));

  assert.equal(path.basename(firstFolder), 's-tach');
  assert.equal(path.basename(path.dirname(second.outputs[0].path)), 's-tach (2)');
  assert.deepEqual(fs.readFileSync(first.outputs[0].path), firstBytes, 'file lần đầu phải giữ nguyên');
});

test('PDF đầu vào đã mã hoá báo PASSWORD_REQUIRED, không tạo thư mục', async t => {
  const dir = tempDir(t);
  const plain = path.join(dir, 'plain.pdf');
  await makePdf(plain, [101]);
  const locked = path.join(dir, 'locked.pdf');
  await qpdf(['--encrypt', 'pw', 'owner', '256', '--', plain, locked]);
  const out = path.join(dir, 'out');
  fs.mkdirSync(out);

  await assert.rejects(
    splitPdf(ctxFor(locked, out, { mode: 'each-page' })),
    e => e.code === 'PASSWORD_REQUIRED',
  );
  assert.deepEqual(fs.readdirSync(out), []);
});

test('PDF hỏng báo INVALID_FILE, không tạo thư mục', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 'broken.pdf');
  fs.writeFileSync(file, '%PDF-1.4 không phải PDF hợp lệ');
  const out = path.join(dir, 'out');
  fs.mkdirSync(out);

  await assert.rejects(
    splitPdf(ctxFor(file, out, { mode: 'each-page' })),
    e => e.code === 'INVALID_FILE' && !e.message.includes(dir),
  );
  assert.deepEqual(fs.readdirSync(out), []);
});

test('huỷ giữa các file dọn sạch thư mục -tach dở dang', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 's.pdf');
  await makePdf(file, [101, 102, 103]);
  const out = path.join(dir, 'out');
  fs.mkdirSync(out);
  const controller = new AbortController();
  let done = 0;
  const ctx = ctxFor(file, out, { mode: 'each-page' }, {
    signal: controller.signal,
    progress() { if (++done === 1) controller.abort(); },
  });

  await assert.rejects(splitPdf(ctx), e => e.name === 'AbortError');
  assert.deepEqual(fs.readdirSync(out), [], 'không được để lại thư mục -tach');
});
