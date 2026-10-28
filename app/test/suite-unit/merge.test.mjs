import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PDFDocument } = require('pdf-lib');
const { merge } = require('../../suite/pdfops/organize.js');
const { ToolError } = require('../../suite/errors.js');
const { binaryPath } = require('../../suite/util/paths.js');
const { runProcess } = require('../../suite/util/spawn.js');
const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function makePdf(file, widths) {
  const doc = await PDFDocument.create();
  for (const w of widths) doc.addPage([w, 200]);
  fs.writeFileSync(file, await doc.save());
}

async function makeCtx(files, dir, qpdf = realQpdf) {
  return {
    files, tempDir: fs.mkdtempSync(path.join(dir, 'tmp-')), outputDir: dir,
    options: {}, signal: new AbortController().signal, progress() {}, qpdf,
  };
}

const realQpdf = (args, opts = {}) => runProcess(
  binaryPath('qpdf.exe', { appRoot: APP_ROOT, isPackaged: false, resourcesPath: '' }),
  args, opts,
);

test('ghép 3 file, giữ thứ tự trang', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsp-merge-'));
  const a = path.join(dir, 'a.pdf'), b = path.join(dir, 'b.pdf'), c = path.join(dir, 'c.pdf');
  await makePdf(a, [101, 102]);
  await makePdf(b, [103]);
  await makePdf(c, [104, 105]);
  const ctx = await makeCtx([a, b, c], dir);
  const result = await merge(ctx);
  const out = result.outputs[0].path;
  assert.match(path.basename(out), /^a-ghep\.pdf$/);
  const doc = await PDFDocument.load(fs.readFileSync(out));
  assert.deepEqual(doc.getPages().map(p => Math.round(p.getWidth())), [101, 102, 103, 104, 105]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('fallback pdf-lib khi qpdf lỗi', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsp-merge-'));
  const a = path.join(dir, 'a.pdf'), b = path.join(dir, 'b.pdf');
  await makePdf(a, [201]); await makePdf(b, [202]);
  const ctx = await makeCtx([a, b], dir, async () => { throw new Error('qpdf không chạy được'); });
  const result = await merge(ctx);
  const doc = await PDFDocument.load(fs.readFileSync(result.outputs[0].path));
  assert.equal(doc.getPageCount(), 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('PDF cần mật khẩu báo PASSWORD_REQUIRED', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsp-merge-'));
  const a = path.join(dir, 'a.pdf');
  await makePdf(a, [100]);
  const ctx = await makeCtx([a, a], dir, async () => {
    throw Object.assign(new Error('invalid password'), { stderr: 'invalid password', code: 'PROCESS_FAILED' });
  });
  await assert.rejects(merge(ctx), e => e instanceof ToolError && e.code === 'PASSWORD_REQUIRED');
  fs.rmSync(dir, { recursive: true, force: true });
});
