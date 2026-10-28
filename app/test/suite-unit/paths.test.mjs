import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { binaryPath, outputName, uniquePath, moveAtomic, publishUnique } = require('../../suite/util/paths.js');

test('đặt tên đầu ra', () => {
  assert.equal(outputName('D:/a/ho-so.pdf', 'ghep'), 'ho-so-ghep.pdf');
});
test('trùng tên thêm (2)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsp-paths-'));
  fs.writeFileSync(path.join(dir, 'a-ghep.pdf'), 'x');
  assert.equal(path.basename(uniquePath(dir, 'a-ghep.pdf')), 'a-ghep (2).pdf');
  fs.rmSync(dir, { recursive: true, force: true });
});
test('binaryPath theo dev/packaged', () => {
  assert.match(binaryPath('qpdf.exe', { appRoot: 'C:/app', isPackaged: false, resourcesPath: '' }), /app[\\/]bin[\\/]win32-x64[\\/]qpdf\.exe$/);
  assert.match(binaryPath('qpdf.exe', { appRoot: 'C:/app', isPackaged: true, resourcesPath: 'C:/res' }), /res[\\/]bin[\\/]win32-x64[\\/]qpdf\.exe$/);
});
test('moveAtomic chuyển file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsp-move-'));
  fs.writeFileSync(path.join(dir, 'a'), 'x');
  moveAtomic(path.join(dir, 'a'), path.join(dir, 'b'));
  assert.equal(fs.readFileSync(path.join(dir, 'b'), 'utf8'), 'x');
  assert.equal(fs.existsSync(path.join(dir, 'a')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});
test('publishUnique giữ file cũ và lùi tên (2)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsp-publish-'));
  fs.writeFileSync(path.join(dir, 'a-ghep.pdf'), 'nội dung cũ');
  const tmp = path.join(dir, 'tmp.pdf');
  fs.writeFileSync(tmp, 'nội dung mới');
  const out = publishUnique(tmp, dir, 'a-ghep.pdf');
  assert.equal(path.basename(out), 'a-ghep (2).pdf');
  assert.equal(fs.readFileSync(path.join(dir, 'a-ghep.pdf'), 'utf8'), 'nội dung cũ');
  assert.equal(fs.readFileSync(out, 'utf8'), 'nội dung mới');
  assert.equal(fs.existsSync(tmp), false);
  fs.rmSync(dir, { recursive: true, force: true });
});
test('publishUnique hai lần cùng tên tạo hai file khác nội dung', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsp-publish-'));
  const tmp1 = path.join(dir, 'tmp1.pdf');
  const tmp2 = path.join(dir, 'tmp2.pdf');
  fs.writeFileSync(tmp1, 'nội dung 1');
  fs.writeFileSync(tmp2, 'nội dung 2');
  const p1 = publishUnique(tmp1, dir, 'a-ghep.pdf');
  const p2 = publishUnique(tmp2, dir, 'a-ghep.pdf');
  assert.notEqual(p1, p2);
  assert.deepEqual([path.basename(p1), path.basename(p2)].sort(), ['a-ghep (2).pdf', 'a-ghep.pdf']);
  assert.equal(fs.readFileSync(p1, 'utf8'), 'nội dung 1');
  assert.equal(fs.readFileSync(p2, 'utf8'), 'nội dung 2');
  assert.equal(fs.existsSync(tmp1) || fs.existsSync(tmp2), false);
  fs.rmSync(dir, { recursive: true, force: true });
});
