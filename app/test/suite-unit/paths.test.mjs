import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { binaryPath, outputName, uniquePath, moveAtomic } = require('../../suite/util/paths.js');

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
