import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PDFDocument } = require('pdf-lib');
const { pdfImages } = require('../../suite/pdfops/convert.js');

async function makePdf(file, n) {
  const d = await PDFDocument.create();
  for (let i = 0; i < n; i++) d.addPage([200 + i, 300]);
  fs.writeFileSync(file, await d.save());
}

function ctxFor(file, dir, render) {
  const tempDir = fs.mkdtempSync(path.join(dir, 'tmp-'));
  return {
    files: [file], tempDir, outputDir: dir, signal: new AbortController().signal,
    options: { pages: '', dpi: 72, format: 'png', quality: 90 },
    progress() {}, log() {}, render: { pdfToImages: render },
  };
}

test('xuất đúng số trang, đặt tên và thư mục -anh', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsp-img-'));
  const file = path.join(dir, 'a.pdf');
  await makePdf(file, 3);
  const render = async ({ pages, outDir }) => pages.map(n => {
    const p = path.join(outDir, `p-${n}.png`);
    fs.writeFileSync(p, 'png');
    return { page: n, path: p };
  });
  const r = await pdfImages(ctxFor(file, dir, render));
  assert.equal(r.outputs.length, 3);
  assert.equal(path.basename(path.dirname(r.outputs[0].path)), 'a-anh');
  assert.match(path.basename(r.outputs[0].path), /^a-01\.png$/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('tôn trọng khoảng trang và định dạng jpg', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsp-img-'));
  const file = path.join(dir, 'b.pdf');
  await makePdf(file, 4);
  const render = async ({ pages, outDir, format }) => pages.map(n => {
    const p = path.join(outDir, `p-${n}.${format}`);
    fs.writeFileSync(p, 'x');
    return { page: n, path: p };
  });
  const ctx = ctxFor(file, dir, render);
  ctx.options = { ...ctx.options, pages: '2-3', format: 'jpg' };
  const r = await pdfImages(ctx);
  assert.deepEqual(r.outputs.map(o => path.basename(o.path)), ['b-02.jpg', 'b-03.jpg']);
  fs.rmSync(dir, { recursive: true, force: true });
});
