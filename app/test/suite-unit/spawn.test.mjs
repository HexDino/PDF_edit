import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { runProcess } = require('../../suite/util/spawn.js');

test('trả stdout và mã 0', async () => {
  const r = await runProcess(process.execPath, ['-e', 'process.stdout.write("ok")']);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, 'ok');
});
test('lỗi mã khác 0', async () => {
  await assert.rejects(
    runProcess(process.execPath, ['-e', 'process.stderr.write("hỏng"); process.exit(2)']),
    e => e.code === 'PROCESS_FAILED' && e.exitCode === 2,
  );
});
test('huỷ dừng nhanh', async () => {
  const ac = new AbortController();
  const p = runProcess(process.execPath, ['-e', 'setTimeout(()=>{}, 5000)'], { signal: ac.signal });
  setTimeout(() => ac.abort(), 100);
  const t0 = Date.now();
  await assert.rejects(p, e => e.code === 'CANCELLED');
  assert.ok(Date.now() - t0 < 2000);
});
test('quá thời gian báo TIMEOUT và dừng tiến trình', async () => {
  const t0 = Date.now();
  await assert.rejects(
    runProcess(process.execPath, ['-e', 'setTimeout(()=>{}, 5000)'], { timeoutMs: 150 }),
    e => e.code === 'TIMEOUT',
  );
  assert.ok(Date.now() - t0 < 2000);
});
test('signal đã huỷ trước khi chạy vẫn báo CANCELLED', async () => {
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(
    runProcess(process.execPath, ['-e', 'process.stdout.write("x")'], { signal: ac.signal }),
    e => e.code === 'CANCELLED',
  );
});
