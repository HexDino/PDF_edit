import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('qpdf 12.4.2 chạy được', () => {
  const out = execFileSync(process.execPath, ['scripts/fetch-qpdf.mjs', '--check'], {
    cwd: APP_ROOT, encoding: 'utf8',
  });
  assert.match(out, /qpdf version 12\.4\.2/);
});

test('cấu hình build tự tải qpdf và đóng gói extraResources', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.prebuild, 'npm run fetch:qpdf');
  assert.deepEqual(pkg.build.extraResources.find(r => r.from === 'bin'), { from: 'bin', to: 'bin' });
  assert.ok(pkg.build.files.includes('suite/**/*'));
});
