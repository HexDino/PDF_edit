import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { JobRunner } = require('../../suite/jobs.js');
const { ToolError } = require('../../suite/errors.js');

function setup(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsp-jobs-'));
  fs.writeFileSync(path.join(root, 'in.pdf'), 'x');
  const tool = { id: 'fake', status: 'available', multiple: false, options: [], run };
  const events = [];
  const runner = new JobRunner({
    tools: [tool], qpdfPath: 'qpdf.exe', tempRoot: path.join(root, 'jobs'),
    onEvent: e => events.push(e), log: () => {},
  });
  return { root, runner, events, tool };
}

test('job thành công tạo output và phát event', async () => {
  const { root, runner, events } = setup(async ctx => {
    const out = path.join(ctx.tempDir, 'x.pdf');
    fs.writeFileSync(out, 'pdf');
    return { outputs: [{ path: out }], errors: [] };
  });
  const id = runner.start({ toolId: 'fake', files: [path.join(root, 'in.pdf')], options: {}, outputDir: root });
  await waitFor(() => events.some(e => e.jobId === id && e.type === 'done'));
  const done = events.find(e => e.jobId === id && e.type === 'done');
  assert.equal(done.outputs[0].bytes, 3);
  fs.rmSync(root, { recursive: true, force: true });
});

test('job lỗi phát mã lỗi', async () => {
  const { root, runner, events } = setup(async () => { throw new ToolError('INVALID_FILE', 'File hỏng'); });
  runner.start({ toolId: 'fake', files: [path.join(root, 'in.pdf')], options: {}, outputDir: root });
  await waitFor(() => events.some(e => e.type === 'error'));
  assert.equal(events.find(e => e.type === 'error').error.code, 'INVALID_FILE');
  fs.rmSync(root, { recursive: true, force: true });
});

test('huỷ job đang chạy', async () => {
  const { root, runner, events } = setup(ctx => new Promise((resolve, reject) => {
    ctx.signal.addEventListener('abort', () => reject(new ToolError('CANCELLED', 'Đã huỷ')));
  }));
  const id = runner.start({ toolId: 'fake', files: [path.join(root, 'in.pdf')], options: {}, outputDir: root });
  await waitFor(() => events.some(e => e.jobId === id && e.type === 'started'));
  assert.equal(runner.cancel(id), true);
  await waitFor(() => events.some(e => e.jobId === id && e.type === 'cancelled'));
  fs.rmSync(root, { recursive: true, force: true });
});

test('từ chối tool không khả dụng', () => {
  const { root, runner } = setup(async () => ({ outputs: [] }));
  runner.tools.get('fake').status = 'planned';
  assert.throws(() => runner.start({ toolId: 'fake', files: [path.join(root, 'x.pdf')], options: {} }), e => e.code === 'UNSUPPORTED');
  fs.rmSync(root, { recursive: true, force: true });
});

async function waitFor(fn, timeout = 2000) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error('timeout');
    await new Promise(r => setTimeout(r, 10));
  }
}
