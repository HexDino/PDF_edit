import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { PDFDocument, degrees } = require('pdf-lib');
const { organizeTool } = require('../../suite/pdfops/reorder.js');
const { runProcess } = require('../../suite/util/spawn.js');
const { binaryPath } = require('../../suite/util/paths.js');

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const qpdf = (args, opts = {}) => runProcess(
  binaryPath('qpdf.exe', { appRoot: APP_ROOT, isPackaged: false }),
  args, opts,
);

// Mỗi trang có bề rộng riêng để kiểm tra đúng trang được chép sang.
// Trang nguồn có nội dung để phân biệt với trang trắng chèn thêm.
async function makePdf(file, pages) {
  const doc = await PDFDocument.create();
  for (const spec of pages) {
    const page = doc.addPage([spec.width, spec.height ?? 200]);
    if (spec.rotation) page.setRotation(degrees(spec.rotation));
    page.drawRectangle({ x: 1, y: 1, width: 2, height: 2 });
  }
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsp-organize-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function readPages(file) {
  const doc = await PDFDocument.load(fs.readFileSync(file));
  return doc.getPages().map(page => {
    const angle = page.getRotation().angle;
    return {
      width: Math.round(page.getWidth()),
      height: Math.round(page.getHeight()),
      angle,
      normalized: ((angle % 360) + 360) % 360,
      hasContent: !!page.node.Contents(),
    };
  });
}

test('thứ tự 3,1,2: các trang ra đúng thứ tự bề rộng', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 's.pdf');
  await makePdf(file, [{ width: 101 }, { width: 102 }, { width: 103 }]);
  const out = path.join(dir, 'out');
  fs.mkdirSync(out);

  const r = await organizeTool(ctxFor(file, out, { order: '3,1,2', rotate: '0', blankCount: 0 }));
  assert.equal(r.outputs.length, 1);
  assert.equal(path.basename(r.outputs[0].path), 's-to-chuc.pdf');
  const pages = await readPages(r.outputs[0].path);
  assert.deepEqual(pages.map(p => p.width), [103, 101, 102]);
  assert.equal(r.stats.pages, 3);
});

test('order trùng trang 1,1,2 nhân bản đúng số trang', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 's.pdf');
  await makePdf(file, [{ width: 101 }, { width: 102 }, { width: 103 }]);

  const r = await organizeTool(ctxFor(file, dir, { order: '1,1,2', rotate: 0, blankCount: 0 }));
  const pages = await readPages(r.outputs[0].path);
  assert.deepEqual(pages.map(p => p.width), [101, 101, 102]);
});

test('order trống giữ nguyên toàn bộ trang', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 's.pdf');
  await makePdf(file, [{ width: 101 }, { width: 102 }, { width: 103 }]);

  const r = await organizeTool(ctxFor(file, dir, { order: '', rotate: 0, blankCount: 0 }));
  const pages = await readPages(r.outputs[0].path);
  assert.deepEqual(pages.map(p => p.width), [101, 102, 103]);
});

test('xoay 90 cộng vào góc xoay sẵn có: 90/450 đều hiểu là 90', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 's.pdf');
  await makePdf(file, [
    { width: 101, rotation: 0 },
    { width: 102, rotation: 360 },
    { width: 103, rotation: 90 },
  ]);

  const r = await organizeTool(ctxFor(file, dir, { order: '', rotate: '90', blankCount: 0 }));
  const pages = await readPages(r.outputs[0].path);
  assert.deepEqual(pages.map(p => p.angle), [90, 450, 180]);
  assert.deepEqual(pages.map(p => p.normalized), [90, 90, 180]);
});

test('blankCount 2 thêm 2 trang trắng cuối, cùng khổ trang cuối', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 's.pdf');
  await makePdf(file, [{ width: 101 }, { width: 102 }, { width: 103 }]);

  const r = await organizeTool(ctxFor(file, dir, { order: '', rotate: 90, blankCount: 2 }));
  const pages = await readPages(r.outputs[0].path);
  assert.equal(pages.length, 5);
  assert.deepEqual(pages.map(p => p.width), [101, 102, 103, 103, 103]);
  assert.deepEqual(pages.slice(0, 3).map(p => p.hasContent), [true, true, true]);
  assert.deepEqual(pages.slice(3).map(p => p.hasContent), [false, false]);
  assert.deepEqual(pages.map(p => p.normalized), [90, 90, 90, 90, 90]);
  assert.equal(r.stats.pages, 5);
});

test('order ngoài phạm vi báo INVALID_RANGE, không tạo output', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 's.pdf');
  await makePdf(file, [{ width: 101 }, { width: 102 }]);

  await assert.rejects(
    organizeTool(ctxFor(file, dir, { order: '3', rotate: 0, blankCount: 0 })),
    e => e.code === 'INVALID_RANGE',
  );
  assert.equal(fs.existsSync(path.join(dir, 's-to-chuc.pdf')), false);
});

test('rotate/blankCount không hợp lệ báo INVALID_OPTIONS', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 's.pdf');
  await makePdf(file, [{ width: 101 }]);

  await assert.rejects(
    organizeTool(ctxFor(file, dir, { order: '', rotate: 45, blankCount: 0 })),
    e => e.code === 'INVALID_OPTIONS',
  );
  await assert.rejects(
    organizeTool(ctxFor(file, dir, { order: '', rotate: 0, blankCount: 51 })),
    e => e.code === 'INVALID_OPTIONS',
  );
});

test('không ghi đè file đã có: lần hai nhận tên (2)', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 's.pdf');
  await makePdf(file, [{ width: 101 }, { width: 102 }]);

  const first = await organizeTool(ctxFor(file, dir, { order: '1', rotate: 0, blankCount: 0 }));
  const before = fs.readFileSync(first.outputs[0].path);
  const second = await organizeTool(ctxFor(file, dir, { order: '2', rotate: 0, blankCount: 0 }));

  assert.equal(path.basename(second.outputs[0].path), 's-to-chuc (2).pdf');
  assert.deepEqual(fs.readFileSync(first.outputs[0].path), before, 'file đầu tiên phải giữ nguyên');
  assert.deepEqual((await readPages(second.outputs[0].path)).map(p => p.width), [102]);
});

test('PDF đầu vào đã mã hoá báo PASSWORD_REQUIRED, không tạo output', async t => {
  const dir = tempDir(t);
  const plain = path.join(dir, 'plain.pdf');
  await makePdf(plain, [{ width: 101 }]);
  const locked = path.join(dir, 'locked.pdf');
  await qpdf(['--encrypt', 'pw', 'owner', '256', '--', plain, locked]);

  await assert.rejects(
    organizeTool(ctxFor(locked, dir, { order: '', rotate: 0, blankCount: 0 })),
    e => e.code === 'PASSWORD_REQUIRED',
  );
  assert.equal(fs.existsSync(path.join(dir, 'locked-to-chuc.pdf')), false);
});

test('PDF hỏng báo INVALID_FILE, không tạo output', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 'broken.pdf');
  fs.writeFileSync(file, 'không phải PDF');

  await assert.rejects(
    organizeTool(ctxFor(file, dir, { order: '', rotate: 0, blankCount: 0 })),
    e => e.code === 'INVALID_FILE' && !e.message.includes(dir),
  );
  assert.equal(fs.existsSync(path.join(dir, 'broken-to-chuc.pdf')), false);
});

test('huỷ trước khi publish không để lại file đầu ra', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 's.pdf');
  await makePdf(file, [{ width: 101 }, { width: 102 }]);
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    organizeTool(ctxFor(file, dir, { order: '', rotate: 0, blankCount: 0 }, { signal: controller.signal })),
    e => e.name === 'AbortError',
  );
  assert.equal(fs.existsSync(path.join(dir, 's-to-chuc.pdf')), false);
});
