import test from 'node:test';
import assert from 'node:assert/strict';
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
