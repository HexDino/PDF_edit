import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { PDFDocument } = require('pdf-lib');
const { pagesTool } = require('../../suite/pdfops/pageops.js');
const { runProcess } = require('../../suite/util/spawn.js');
const { binaryPath } = require('../../suite/util/paths.js');

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const qpdf = (args, opts = {}) => runProcess(
  binaryPath('qpdf.exe', { appRoot: APP_ROOT, isPackaged: false }),
  args, opts,
);

async function makePdf(file, widths) {
  const doc = await PDFDocument.create();
  for (const w of widths) doc.addPage([w, 200]);
  fs.writeFileSync(file, await doc.save());
}

function ctxFor(file, dir, options = {}, overrides = {}) {
  const tempDir = fs.mkdtempSync(path.join(dir, 'tmp-'));
  return {
    files: [file], tempDir, outputDir: dir, signal: new AbortController().signal,
    options, progress() {}, log() {}, ...overrides,
  };
}

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsp-pages-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function pageWidths(file) {
  const doc = await PDFDocument.load(fs.readFileSync(file));
  return doc.getPages().map(p => Math.round(p.getWidth()));
}

test('xoá trang: bỏ đúng trang, giữ thứ tự còn lại', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 'p.pdf');
  await makePdf(file, [101, 102, 103, 104, 105]);

  const r = await pagesTool(ctxFor(file, dir, { mode: 'delete', pages: '2,4' }));
  assert.equal(r.outputs.length, 1);
  assert.equal(path.basename(r.outputs[0].path), 'p-xoa-trang.pdf');
  assert.deepEqual(await pageWidths(r.outputs[0].path), [101, 103, 105]);
});

test('trích trang: giữ đúng thứ tự và lặp trang', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 'p.pdf');
  await makePdf(file, [101, 102, 103, 104, 105]);

  const r = await pagesTool(ctxFor(file, dir, { mode: 'extract', pages: '4,2,2' }));
  assert.equal(path.basename(r.outputs[0].path), 'p-trich-trang.pdf');
  assert.deepEqual(await pageWidths(r.outputs[0].path), [104, 102, 102]);
});

test('trích với khoảng trống lấy tất cả trang', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 'p.pdf');
  await makePdf(file, [101, 102, 103]);

  const r = await pagesTool(ctxFor(file, dir, { mode: 'extract', pages: '' }));
  assert.deepEqual(await pageWidths(r.outputs[0].path), [101, 102, 103]);
});

test('xoá tất cả trang báo NO_PAGES, không tạo output', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 'p.pdf');
  await makePdf(file, [101, 102, 103]);

  await assert.rejects(
    pagesTool(ctxFor(file, dir, { mode: 'delete', pages: '1-3' })),
    e => e.code === 'NO_PAGES',
  );
  assert.equal(fs.existsSync(path.join(dir, 'p-xoa-trang.pdf')), false);
});

test('không ghi đè file đã có: lần hai nhận tên (2)', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 'p.pdf');
  await makePdf(file, [101, 102]);

  const first = await pagesTool(ctxFor(file, dir, { mode: 'extract', pages: '2' }));
  const before = fs.readFileSync(first.outputs[0].path);
  const second = await pagesTool(ctxFor(file, dir, { mode: 'extract', pages: '1' }));

  assert.equal(path.basename(second.outputs[0].path), 'p-trich-trang (2).pdf');
  assert.deepEqual(fs.readFileSync(first.outputs[0].path), before, 'file đầu tiên phải giữ nguyên');
  assert.deepEqual(await pageWidths(second.outputs[0].path), [101]);
});

test('PDF đầu vào đã mã hoá báo PASSWORD_REQUIRED, không tạo output', async t => {
  const dir = tempDir(t);
  const plain = path.join(dir, 'plain.pdf');
  await makePdf(plain, [101]);
  const locked = path.join(dir, 'locked.pdf');
  await qpdf(['--encrypt', 'pw', 'owner', '256', '--', plain, locked]);

  await assert.rejects(
    pagesTool(ctxFor(locked, dir, { mode: 'extract', pages: '1' })),
    e => e.code === 'PASSWORD_REQUIRED',
  );
  assert.equal(fs.existsSync(path.join(dir, 'locked-trich-trang.pdf')), false);
});

test('PDF hỏng báo INVALID_FILE, không tạo output', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 'broken.pdf');
  fs.writeFileSync(file, 'không phải PDF');

  await assert.rejects(
    pagesTool(ctxFor(file, dir, { mode: 'delete', pages: '1' })),
    e => e.code === 'INVALID_FILE' && !e.message.includes(dir),
  );
  assert.equal(fs.existsSync(path.join(dir, 'broken-xoa-trang.pdf')), false);
});

test('huỷ trước khi publish không để lại file đầu ra', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 'p.pdf');
  await makePdf(file, [101, 102]);
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    pagesTool(ctxFor(file, dir, { mode: 'extract', pages: '1' }, { signal: controller.signal })),
    e => e.name === 'AbortError',
  );
  assert.equal(fs.existsSync(path.join(dir, 'p-trich-trang.pdf')), false);
});
