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

test('giữ a-ghep.pdf cũ, đầu ra mới lùi tên (2)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsp-merge-'));
  const a = path.join(dir, 'a.pdf'), b = path.join(dir, 'b.pdf');
  await makePdf(a, [301]); await makePdf(b, [302]);
  const existing = path.join(dir, 'a-ghep.pdf');
  fs.writeFileSync(existing, 'FILE CŨ');
  const result = await merge(await makeCtx([a, b], dir));
  const out = result.outputs[0].path;
  assert.equal(path.basename(out), 'a-ghep (2).pdf');
  assert.equal(path.dirname(out), dir);
  assert.equal(fs.readFileSync(existing, 'utf8'), 'FILE CŨ');
  const doc = await PDFDocument.load(fs.readFileSync(out));
  assert.equal(doc.getPageCount(), 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('hai job cùng tên đầu ra không ghi đè nhau', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsp-merge-'));
  const a = path.join(dir, 'a.pdf'), b1 = path.join(dir, 'b1.pdf'), b2 = path.join(dir, 'b2.pdf');
  await makePdf(a, [401]); await makePdf(b1, [402]); await makePdf(b2, [403]);
  const [r1, r2] = await Promise.all([
    merge(await makeCtx([a, b1], dir)),
    merge(await makeCtx([a, b2], dir)),
  ]);
  const p1 = r1.outputs[0].path, p2 = r2.outputs[0].path;
  assert.notEqual(p1, p2);
  assert.deepEqual([path.basename(p1), path.basename(p2)].sort(), ['a-ghep (2).pdf', 'a-ghep.pdf']);
  const widths = async file => {
    const doc = await PDFDocument.load(fs.readFileSync(file));
    return doc.getPages().map(p => Math.round(p.getWidth()));
  };
  const w1 = await widths(p1), w2 = await widths(p2);
  assert.equal(w1.length, 2);
  assert.equal(w2.length, 2);
  assert.deepEqual([w1, w2].sort((x, y) => x[1] - y[1]), [[401, 402], [401, 403]]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('qpdf exit code 3 có file tạm vẫn dùng kết quả qpdf', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsp-merge-'));
  const a = path.join(dir, 'a.pdf'), b = path.join(dir, 'b.pdf');
  await makePdf(a, [501]); await makePdf(b, [502]);
  const warned = await PDFDocument.create();
  warned.addPage([999, 200]);
  const bytes = await warned.save();
  const ctx = await makeCtx([a, b], dir, async args => {
    fs.writeFileSync(args[args.length - 1], bytes);
    throw Object.assign(new Error('qpdf: warning'), {
      code: 'PROCESS_FAILED', exitCode: 3, stderr: 'qpdf: warning',
    });
  });
  const result = await merge(ctx);
  const doc = await PDFDocument.load(fs.readFileSync(result.outputs[0].path));
  assert.deepEqual(doc.getPages().map(p => Math.round(p.getWidth())), [999]);
  assert.equal(result.stats.pages, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('lỗi qpdf nhắc tên file chứa “encrypted” không bị coi là mật khẩu', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsp-merge-'));
  const a = path.join(dir, 'encrypted-a.pdf'), b = path.join(dir, 'b.pdf');
  await makePdf(a, [601]); await makePdf(b, [602]);
  const ctx = await makeCtx([a, b], dir, async () => {
    throw Object.assign(new Error(`qpdf: cannot open ${a}`), {
      code: 'PROCESS_FAILED', exitCode: 2, stderr: `qpdf: cannot open ${a}`,
    });
  });
  const result = await merge(ctx);
  const doc = await PDFDocument.load(fs.readFileSync(result.outputs[0].path));
  assert.deepEqual(doc.getPages().map(p => Math.round(p.getWidth())), [601, 602]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('job bị huỷ trước khi publish không để lại file đầu ra', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsp-merge-'));
  const a = path.join(dir, 'a.pdf'), b = path.join(dir, 'b.pdf');
  await makePdf(a, [701]); await makePdf(b, [702]);
  const prebuilt = await PDFDocument.create();
  prebuilt.addPage([999, 200]);
  const bytes = await prebuilt.save();
  const controller = new AbortController();
  const ctx = {
    files: [a, b], tempDir: fs.mkdtempSync(path.join(dir, 'tmp-')), outputDir: dir,
    options: {}, signal: controller.signal, progress() {},
    qpdf: async args => {
      fs.writeFileSync(args[args.length - 1], bytes);
      controller.abort();
      return { code: 0, stdout: '', stderr: '' };
    },
  };
  await assert.rejects(merge(ctx), e => e.name === 'AbortError');
  assert.equal(fs.existsSync(path.join(dir, 'a-ghep.pdf')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});
