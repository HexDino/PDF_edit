import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { PDFDocument } = require('pdf-lib');
const { unlockTool } = require('../../suite/pdfops/unlock.js');
const { runProcess } = require('../../suite/util/spawn.js');
const { binaryPath } = require('../../suite/util/paths.js');

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const QPDF = binaryPath('qpdf.exe', { appRoot: APP_ROOT, isPackaged: false });

function qpdf(args, opts = {}) {
  return runProcess(QPDF, args, opts);
}

async function makePdf(file, n = 1) {
  const d = await PDFDocument.create();
  for (let i = 0; i < n; i++) d.addPage([200 + i, 300]);
  fs.writeFileSync(file, await d.save());
}

// Fixture AES-256 với mật khẩu mở "secret" (đúng như người dùng nhận được).
async function makeLocked(src, dst, user = 'secret', owner = 'owner') {
  await qpdf(['--encrypt', `--user-password=${user}`, `--owner-password=${owner}`,
    '--bits=256', '--', src, dst]);
  return dst;
}

function ctxFor(file, dir, options = {}) {
  const tempDir = fs.mkdtempSync(path.join(dir, 'tmp-'));
  return {
    files: [file], tempDir, outputDir: dir, signal: new AbortController().signal,
    options: { password: 'secret', ...options },
    progress() {}, log() {},
    qpdf: (args, opts = {}) => qpdf(args, opts),
  };
}

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsp-unlock-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('mở khoá AES-256 bằng mật khẩu đúng; file kết quả mở được không cần mật khẩu', async t => {
  const dir = tempDir(t);
  const plain = path.join(dir, 'nguon.pdf');
  await makePdf(plain, 2);
  const locked = path.join(dir, 'locked.pdf');
  await makeLocked(plain, locked);

  const shown = await qpdf(['--show-encryption', '--password=secret', locked]);
  assert.match(shown.stdout, /R = 6/);
  assert.match(shown.stdout, /AESv3/);
  assert.match(shown.stdout, /Supplied password is user password/);

  const ctx = ctxFor(locked, dir);
  const r = await unlockTool(ctx);
  assert.equal(r.outputs.length, 1);
  const out = r.outputs[0].path;
  assert.equal(path.basename(out), 'locked-mo-khoa.pdf');
  assert.equal(path.dirname(path.resolve(out)), path.resolve(dir));
  assert.ok(fs.statSync(out).size > 0, 'file mở khoá phải có dữ liệu');

  // Không còn mã hoá: mọi lệnh qpdf chạy được mà không cần mật khẩu.
  const noPassword = await qpdf(['--show-encryption', out]);
  assert.match(noPassword.stdout, /File is not encrypted/);
  await qpdf(['--check', out]);
  const doc = await PDFDocument.load(fs.readFileSync(out));
  assert.equal(doc.getPageCount(), 2);

  assert.equal(fs.existsSync(path.join(ctx.tempDir, 'qpdf-args.txt')), false, 'file đối số phải bị xoá');
  assert.equal(fs.existsSync(path.join(ctx.tempDir, 'unlocked.pdf')), false, 'file tạm đã publish phải được dọn');
});

test('sai mật khẩu báo PASSWORD_INVALID, không tạo output, vẫn xoá file đối số', async t => {
  const dir = tempDir(t);
  const plain = path.join(dir, 'a.pdf');
  await makePdf(plain, 1);
  const locked = path.join(dir, 'locked.pdf');
  await makeLocked(plain, locked);

  const ctx = ctxFor(locked, dir, { password: 'wrong' });
  await assert.rejects(
    unlockTool(ctx),
    e => e.code === 'PASSWORD_INVALID' && e.message === 'Mật khẩu không đúng. Thử lại.',
  );
  assert.equal(fs.existsSync(path.join(dir, 'locked-mo-khoa.pdf')), false);
  assert.equal(fs.existsSync(path.join(ctx.tempDir, 'qpdf-args.txt')), false, 'file đối số phải bị xoá');
});

test('mật khẩu trống, thiếu hoặc chứa CR/LF báo INVALID_OPTIONS và không gọi qpdf', async t => {
  const dir = tempDir(t);
  const plain = path.join(dir, 'b.pdf');
  await makePdf(plain, 1);

  for (const options of [{ password: '' }, null, { password: 'a\rb' }, { password: 'a\nb' }]) {
    const ctx = ctxFor(plain, dir, options || {});
    if (!options) delete ctx.options.password;
    let called = false;
    ctx.qpdf = async () => { called = true; throw new Error('không được gọi qpdf'); };
    await assert.rejects(unlockTool(ctx), e => e.code === 'INVALID_OPTIONS');
    assert.equal(called, false, 'tuỳ chọn sai phải bị chặn trước khi chạy qpdf');
    assert.equal(fs.existsSync(path.join(ctx.tempDir, 'qpdf-args.txt')), false);
  }
  assert.equal(fs.existsSync(path.join(dir, 'b-mo-khoa.pdf')), false);
});

test('không ghi đè: lần hai nhận tên (2), file đầu giữ nguyên', async t => {
  const dir = tempDir(t);
  const plain = path.join(dir, 'c.pdf');
  await makePdf(plain, 2);
  const locked = path.join(dir, 'locked.pdf');
  await makeLocked(plain, locked);

  const first = await unlockTool(ctxFor(locked, dir));
  const firstPath = first.outputs[0].path;
  const before = fs.readFileSync(firstPath);

  const second = await unlockTool(ctxFor(locked, dir));
  assert.equal(path.basename(second.outputs[0].path), 'locked-mo-khoa (2).pdf');
  assert.deepEqual(fs.readFileSync(firstPath), before, 'file đầu tiên phải giữ nguyên');
});

test('mật khẩu chỉ nằm trong file đối số; không lên dòng lệnh, không vào log', async t => {
  const dir = tempDir(t);
  const plain = path.join(dir, 'd.pdf');
  await makePdf(plain, 1);
  const locked = path.join(dir, 'locked.pdf');
  await makeLocked(plain, locked);

  const ctx = ctxFor(locked, dir);
  const direct = ctx.qpdf;
  const calls = [];
  const logs = [];
  ctx.log = message => logs.push(String(message));
  ctx.qpdf = async (args, opts = {}) => {
    calls.push([...args]);
    assert.equal(args.length, 1, 'chỉ được truyền một đối số @file');
    assert.match(args[0], /^@/);
    const argFile = args[0].slice(1);
    assert.ok(fs.existsSync(argFile), 'file đối số phải tồn tại khi qpdf chạy');
    const lines = fs.readFileSync(argFile, 'utf8').trimEnd().split('\n');
    assert.deepEqual(lines.slice(0, 3), ['--password=secret', '--decrypt', '--']);
    assert.equal(lines.length, 5);
    assert.equal(lines[3], locked);
    assert.equal(lines[4], path.join(ctx.tempDir, 'unlocked.pdf'));
    return direct(args, opts);
  };

  const r = await unlockTool(ctx);
  assert.ok(fs.existsSync(r.outputs[0].path));
  assert.equal(calls.length, 1);
  for (const args of calls) {
    for (const arg of args) assert.equal(arg.includes('secret'), false);
  }
  assert.equal(logs.join('\n').includes('secret'), false);
  assert.equal(fs.existsSync(path.join(ctx.tempDir, 'qpdf-args.txt')), false, 'file đối số phải bị xoá');
});

test('mật khẩu có dấu cách, bắt đầu bằng - hoặc @ vẫn là một giá trị', async t => {
  const dir = tempDir(t);
  const plain = path.join(dir, 'e.pdf');
  await makePdf(plain, 1);
  const locked = path.join(dir, 'locked.pdf');
  const password = '-@ mật khẩu có dấu cách @-';
  await makeLocked(plain, locked, password);

  const ctx = ctxFor(locked, dir, { password });
  ctx.qpdf = async () => {
    throw new Error('phải dùng qpdf thật cho mật khẩu đặc biệt');
  };
  await assert.rejects(unlockTool(ctx), e => e.code === 'INTERNAL');

  // Chạy lại với qpdf thật: qpdf phải mở được đúng mật khẩu từ argfile.
  const ok = await unlockTool(ctxFor(locked, dir, { password }));
  await qpdf(['--check', ok.outputs[0].path]);
  const shown = await qpdf(['--show-encryption', ok.outputs[0].path]);
  assert.match(shown.stdout, /File is not encrypted/);
});

test('qpdf mã 3 kèm file tạm dùng được vẫn được chấp nhận', async t => {
  const dir = tempDir(t);
  const plain = path.join(dir, 'f.pdf');
  await makePdf(plain, 1);
  const locked = path.join(dir, 'locked.pdf');
  await makeLocked(plain, locked);

  const ctx = ctxFor(locked, dir);
  ctx.qpdf = async () => {
    fs.writeFileSync(path.join(ctx.tempDir, 'unlocked.pdf'), '%PDF-1.4\n% giả lập cảnh báo\n');
    throw Object.assign(new Error('operation succeeded with warnings'), {
      exitCode: 3, stderr: 'WARNING: file is damaged',
    });
  };
  const r = await unlockTool(ctx);
  assert.equal(path.basename(r.outputs[0].path), 'locked-mo-khoa.pdf');
  assert.ok(fs.statSync(r.outputs[0].path).size > 0);
  assert.equal(fs.existsSync(path.join(ctx.tempDir, 'qpdf-args.txt')), false);
});

test('qpdf mã 3 nhưng không có file tạm thì báo INTERNAL', async t => {
  const dir = tempDir(t);
  const plain = path.join(dir, 'g.pdf');
  await makePdf(plain, 1);
  const locked = path.join(dir, 'locked.pdf');
  await makeLocked(plain, locked);

  const ctx = ctxFor(locked, dir);
  ctx.qpdf = async () => {
    throw Object.assign(new Error('operation succeeded with warnings'), {
      exitCode: 3, stderr: 'WARNING: file is damaged',
    });
  };
  await assert.rejects(unlockTool(ctx), e => e.code === 'INTERNAL');
  assert.equal(fs.existsSync(path.join(dir, 'locked-mo-khoa.pdf')), false);
  assert.equal(fs.existsSync(path.join(ctx.tempDir, 'qpdf-args.txt')), false);
});

test('PDF chưa mã hoá: qpdf vẫn tạo file sạch, thành công và ghi đè không xảy ra', async t => {
  const dir = tempDir(t);
  const plain = path.join(dir, 'h.pdf');
  await makePdf(plain, 1);

  const r = await unlockTool(ctxFor(plain, dir));
  assert.equal(path.basename(r.outputs[0].path), 'h-mo-khoa.pdf');
  const shown = await qpdf(['--show-encryption', r.outputs[0].path]);
  assert.match(shown.stdout, /File is not encrypted/);
  await qpdf(['--check', r.outputs[0].path]);
  const doc = await PDFDocument.load(fs.readFileSync(r.outputs[0].path));
  assert.equal(doc.getPageCount(), 1);
});

test('CANCELLED được chuyển tiếp và file đối số vẫn bị xoá', async t => {
  const dir = tempDir(t);
  const plain = path.join(dir, 'i.pdf');
  await makePdf(plain, 1);
  const locked = path.join(dir, 'locked.pdf');
  await makeLocked(plain, locked);

  const ctx = ctxFor(locked, dir);
  ctx.qpdf = async () => {
    throw Object.assign(new Error('Đã huỷ'), { code: 'CANCELLED' });
  };
  await assert.rejects(unlockTool(ctx), e => e.code === 'CANCELLED');
  assert.equal(fs.existsSync(path.join(ctx.tempDir, 'qpdf-args.txt')), false);
});
