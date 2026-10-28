import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createLogger } = require('../../suite/util/log.js');

test('ghi và xoay vòng log', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsp-log-'));
  const file = path.join(dir, 'tools.log');
  const log = createLogger(file, { maxBytes: 40, keep: 2 });
  log('12345678901234567890');
  log('12345678901234567890');
  log('sau khi xoay');
  assert.ok(fs.existsSync(`${file}.1`));
  assert.match(fs.readFileSync(file, 'utf8'), /sau khi xoay/);
  fs.rmSync(dir, { recursive: true, force: true });
});
