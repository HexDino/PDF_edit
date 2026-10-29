import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { PDFDocument, degrees } = require('pdf-lib');
const { cropTool } = require('../../suite/pdfops/crop.js');
const { runProcess } = require('../../suite/util/spawn.js');
const { binaryPath } = require('../../suite/util/paths.js');

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const qpdf = (args, opts = {}) => runProcess(
  binaryPath('qpdf.exe', { appRoot: APP_ROOT, isPackaged: false }),
  args, opts,
);
const MM = 72 / 25.4;

async function makePdf(file, specs = [[300, 200, 0], [300, 200, 90], [300, 200, 180], [300, 200, 270]]) {
  const doc = await PDFDocument.create();
  for (const [width, height, rotation] of specs) {
    const page = doc.addPage([width, height]);
    if (rotation) page.setRotation(degrees(rotation));
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsp-crop-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function readPages(file) {
  const doc = await PDFDocument.load(fs.readFileSync(file));
  return doc.getPages().map(page => ({
    rotation: ((page.getRotation().angle % 360) + 360) % 360,
    media: page.getMediaBox(),
    crop: page.getCropBox(),
  }));
}

function assertBox(actual, expected, label) {
  for (const key of ['x', 'y', 'width', 'height']) {
    assert.ok(
      Math.abs(actual[key] - expected[key]) < 1e-6,
      `${label}.${key}: mong đợi ${expected[key]}, nhận ${actual[key]}`,
    );
  }
}

test('crop 10mm đều bốn phía trên trang xoay 0/90/180/270', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 'c.pdf');
  await makePdf(file);
  const out = path.join(dir, 'out');
  fs.mkdirSync(out);

  const m = 10 * MM;
  const r = await cropTool(ctxFor(file, out, { top: 10, right: 10, bottom: 10, left: 10, pages: '' }));
  assert.equal(r.outputs.length, 1);
  assert.equal(path.basename(r.outputs[0].path), 'c-crop.pdf');
  const pages = await readPages(r.outputs[0].path);
  assert.equal(pages.length, 4);
  const expected = { x: m, y: m, width: 300 - 2 * m, height: 200 - 2 * m };
  for (const [i, page] of pages.entries()) {
    assert.equal(page.rotation, i * 90, `trang ${i + 1} giữ góc xoay`);
    assertBox(page.crop, expected, `trang ${i + 1}`);
    assertBox(page.media, { x: 0, y: 0, width: 300, height: 200 }, `media trang ${i + 1}`);
  }
});

test('crop lề không đều: toạ độ CropBox map đúng qua góc xoay', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 'c.pdf');
  await makePdf(file);

  const top = 10 * MM;
  const right = 20 * MM;
  const bottom = 30 * MM;
  const left = 40 * MM;
  const r = await cropTool(ctxFor(file, dir, { top: 10, right: 20, bottom: 30, left: 40, pages: '' }));
  const pages = await readPages(r.outputs[0].path);

  // 0: L/R/T/B thẳng; 90: L=top,R=bottom,T=right,B=left;
  // 180: L=right,R=left,T=bottom,B=top; 270: L=bottom,R=top,T=left,B=right.
  const expected = [
    { x: left, y: bottom, width: 300 - left - right, height: 200 - bottom - top },
    { x: top, y: left, width: 300 - top - bottom, height: 200 - left - right },
    { x: right, y: top, width: 300 - right - left, height: 200 - top - bottom },
    { x: bottom, y: right, width: 300 - bottom - top, height: 200 - right - left },
  ];
  for (const [i, page] of pages.entries()) {
    assertBox(page.crop, expected[i], `trang xoay ${i * 90}`);
  }
});

test('pages chỉ crop đúng trang được chọn, trang khác giữ nguyên', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 'c.pdf');
  await makePdf(file);

  const m = 10 * MM;
  const r = await cropTool(ctxFor(file, dir, { top: 10, right: 10, bottom: 10, left: 10, pages: '2,4' }));
  const pages = await readPages(r.outputs[0].path);
  assertBox(pages[0].crop, { x: 0, y: 0, width: 300, height: 200 }, 'trang 1');
  assertBox(pages[1].crop, { x: m, y: m, width: 300 - 2 * m, height: 200 - 2 * m }, 'trang 2');
  assertBox(pages[2].crop, { x: 0, y: 0, width: 300, height: 200 }, 'trang 3');
  assertBox(pages[3].crop, { x: m, y: m, width: 300 - 2 * m, height: 200 - 2 * m }, 'trang 4');
});

test('khoảng trang ngoài phạm vi báo INVALID_RANGE, không tạo output', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 'c.pdf');
  await makePdf(file);

  await assert.rejects(
    cropTool(ctxFor(file, dir, { top: 10, right: 10, bottom: 10, left: 10, pages: '5' })),
    e => e.code === 'INVALID_RANGE',
  );
  assert.equal(fs.existsSync(path.join(dir, 'c-crop.pdf')), false);
});

test('lề quá lớn hoặc không hợp lệ báo INVALID_OPTIONS', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 'c.pdf');
  await makePdf(file, [[101, 200, 0]]);

  await assert.rejects(
    cropTool(ctxFor(file, dir, { top: 200, right: 200, bottom: 200, left: 200, pages: '' })),
    e => e.code === 'INVALID_OPTIONS',
  );
  await assert.rejects(
    cropTool(ctxFor(file, dir, { top: -1, right: 0, bottom: 0, left: 0, pages: '' })),
    e => e.code === 'INVALID_OPTIONS',
  );
  assert.equal(fs.existsSync(path.join(dir, 'c-crop.pdf')), false);
});

test('không ghi đè file đã có: lần hai nhận tên (2)', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 'c.pdf');
  await makePdf(file, [[300, 200, 0]]);
  const opts = { top: 10, right: 10, bottom: 10, left: 10, pages: '' };

  const first = await cropTool(ctxFor(file, dir, opts));
  const before = fs.readFileSync(first.outputs[0].path);
  const second = await cropTool(ctxFor(file, dir, opts));

  assert.equal(path.basename(second.outputs[0].path), 'c-crop (2).pdf');
  assert.deepEqual(fs.readFileSync(first.outputs[0].path), before, 'file đầu tiên phải giữ nguyên');
});

test('PDF đầu vào đã mã hoá báo PASSWORD_REQUIRED, không tạo output', async t => {
  const dir = tempDir(t);
  const plain = path.join(dir, 'plain.pdf');
  await makePdf(plain, [[300, 200, 0]]);
  const locked = path.join(dir, 'locked.pdf');
  await qpdf(['--encrypt', 'pw', 'owner', '256', '--', plain, locked]);

  await assert.rejects(
    cropTool(ctxFor(locked, dir, { top: 10, right: 10, bottom: 10, left: 10, pages: '' })),
    e => e.code === 'PASSWORD_REQUIRED',
  );
  assert.equal(fs.existsSync(path.join(dir, 'locked-crop.pdf')), false);
});

test('PDF hỏng báo INVALID_FILE, không tạo output', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 'broken.pdf');
  fs.writeFileSync(file, 'không phải PDF');

  await assert.rejects(
    cropTool(ctxFor(file, dir, { top: 10, right: 10, bottom: 10, left: 10, pages: '' })),
    e => e.code === 'INVALID_FILE' && !e.message.includes(dir),
  );
  assert.equal(fs.existsSync(path.join(dir, 'broken-crop.pdf')), false);
});

test('huỷ trước khi publish không để lại file đầu ra', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 'c.pdf');
  await makePdf(file, [[300, 200, 0]]);
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    cropTool(ctxFor(file, dir, { top: 10, right: 10, bottom: 10, left: 10, pages: '' }, { signal: controller.signal })),
    e => e.name === 'AbortError',
  );
  assert.equal(fs.existsSync(path.join(dir, 'c-crop.pdf')), false);
});
