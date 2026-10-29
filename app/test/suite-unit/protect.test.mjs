import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { PDFDocument } = require('pdf-lib');
const { protect } = require('../../suite/pdfops/security.js');
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

function ctxFor(file, dir, options = {}) {
  const tempDir = fs.mkdtempSync(path.join(dir, 'tmp-'));
  return {
    files: [file], tempDir, outputDir: dir, signal: new AbortController().signal,
    options: {
      openPassword: 'secret', ownerPassword: 'owner',
      allowPrint: true, allowCopy: false, allowModify: false, ...options,
    },
    progress() {}, log() {},
    qpdf: (args, opts = {}) => qpdf(args, opts),
  };
}

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsp-protect-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('khoá AES-256, đúng mật khẩu mở được, sai mật khẩu bị từ chối', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 'a.pdf');
  await makePdf(file, 1);

  const r = await protect(ctxFor(file, dir));
  assert.equal(r.outputs.length, 1);
  const out = r.outputs[0].path;
  assert.equal(path.basename(out), 'a-khoa.pdf');
  assert.equal(path.dirname(path.resolve(out)), path.resolve(dir));
  assert.ok(fs.statSync(out).size > 0, 'file khoá phải có dữ liệu');

  const shown = await qpdf(['--show-encryption', '--password=secret', out]);
  assert.match(shown.stdout, /R = 6/);
  assert.match(shown.stdout, /AESv3/);
  assert.match(shown.stdout, /print low resolution: allowed/);
  assert.match(shown.stdout, /extract for any purpose: not allowed/);

  await assert.rejects(
    qpdf(['--check', '--password=wrong', out]),
    e => e.exitCode !== 0,
  );
});

test('không ghi đè file đã có: lần hai nhận tên (2)', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 'a.pdf');
  await makePdf(file, 2);

  const first = await protect(ctxFor(file, dir));
  const firstPath = first.outputs[0].path;
  const before = fs.readFileSync(firstPath);

  const second = await protect(ctxFor(file, dir));
  assert.equal(path.basename(second.outputs[0].path), 'a-khoa (2).pdf');
  assert.ok(fs.existsSync(second.outputs[0].path));
  assert.deepEqual(fs.readFileSync(firstPath), before, 'file khoá đầu tiên phải giữ nguyên');
});

test('PDF đầu vào đã mã hoá báo PASSWORD_REQUIRED, không tạo output', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 'plain.pdf');
  await makePdf(file, 1);
  const locked = path.join(dir, 'locked.pdf');
  await qpdf(['--encrypt', 'input-pw', 'input-owner', '256', '--', file, locked]);
  assert.ok(fs.statSync(locked).size > 0);

  const ctx = ctxFor(locked, dir);
  await assert.rejects(protect(ctx), e => e.code === 'PASSWORD_REQUIRED');
  assert.equal(fs.existsSync(path.join(dir, 'locked-khoa.pdf')), false);
  assert.equal(fs.existsSync(path.join(ctx.tempDir, 'qpdf-args.txt')), false);
});

test('mật khẩu chỉ nằm trong file đối số; không lên dòng lệnh, không vào log', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 'b.pdf');
  await makePdf(file, 1);

  const ctx = ctxFor(file, dir);
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
    const content = fs.readFileSync(argFile, 'utf8');
    assert.match(content, /^--user-password=secret$/m);
    assert.match(content, /^--owner-password=owner$/m);
    return direct(args, opts);
  };

  const r = await protect(ctx);
  assert.ok(fs.existsSync(r.outputs[0].path));
  assert.equal(calls.length, 1);
  for (const args of calls) {
    for (const arg of args) {
      assert.equal(arg.includes('secret'), false);
      assert.equal(arg.includes('owner'), false);
    }
  }
  assert.equal(logs.join('\n').includes('secret'), false);
  assert.equal(fs.existsSync(path.join(ctx.tempDir, 'qpdf-args.txt')), false, 'file đối số phải bị xoá');
  assert.equal(fs.existsSync(path.join(ctx.tempDir, 'protected.pdf')), false, 'file tạm đã publish phải được dọn');
});

test('mật khẩu có dấu cách vẫn là một đối số; owner mặc định trùng mật khẩu mở', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 'c.pdf');
  await makePdf(file, 1);

  const open = 'mật khẩu có dấu cách';
  const owner = 'chủ sở hữu riêng';
  const r = await protect(ctxFor(file, dir, { openPassword: open, ownerPassword: owner }));
  const out = r.outputs[0].path;

  const shown = await qpdf(['--show-encryption', `--password=${open}`, out]);
  assert.match(shown.stdout, /User password = mật khẩu có dấu cách/);
  assert.match(shown.stdout, /AESv3/);

  const asOwner = await qpdf(['--show-encryption', `--password=${owner}`, out]);
  assert.match(asOwner.stdout, /Supplied password is owner password/);

  const noOwner = ctxFor(file, dir, { ownerPassword: undefined });
  delete noOwner.options.ownerPassword;
  const r2 = await protect(noOwner);
  const shown2 = await qpdf(['--show-encryption', '--password=secret', r2.outputs[0].path]);
  assert.match(shown2.stdout, /User password = secret/);
});

test('mật khẩu bắt đầu bằng - hoặc @ vẫn là giá trị, không thành tuỳ chọn', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 'e.pdf');
  await makePdf(file, 1);

  const open = '-@= mật khẩu @-=';
  const owner = '@--chủ sở hữu--@';
  const r = await protect(ctxFor(file, dir, { openPassword: open, ownerPassword: owner }));
  const out = r.outputs[0].path;

  const shown = await qpdf(['--show-encryption', `--password=${open}`, out]);
  assert.match(shown.stdout, /User password = -@= mật khẩu @-=/);
  assert.match(shown.stdout, /AESv3/);

  const asOwner = await qpdf(['--show-encryption', `--password=${owner}`, out]);
  assert.match(asOwner.stdout, /Supplied password is owner password/);
});

test('từ chối mật khẩu trống hoặc chứa xuống dòng', async t => {
  const dir = tempDir(t);
  const file = path.join(dir, 'd.pdf');
  await makePdf(file, 1);

  await assert.rejects(
    protect(ctxFor(file, dir, { openPassword: '' })),
    e => e.code === 'INVALID_OPTIONS',
  );
  await assert.rejects(
    protect(ctxFor(file, dir, { openPassword: 'a\rb' })),
    e => e.code === 'INVALID_OPTIONS',
  );
  await assert.rejects(
    protect(ctxFor(file, dir, { ownerPassword: 'owner\nx' })),
    e => e.code === 'INVALID_OPTIONS',
  );
  assert.equal(fs.existsSync(path.join(dir, 'd-khoa.pdf')), false);
});
