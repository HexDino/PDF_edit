import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { JobRunner } = require('../../suite/jobs.js');
const { ToolError } = require('../../suite/errors.js');

const TERMINALS = new Set(['done', 'error', 'cancelled']);

function setup(run, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsp-jobs-'));
  fs.writeFileSync(path.join(root, 'in.pdf'), 'x');
  const tool = { id: 'fake', status: 'available', multiple: false, options: [], run };
  const events = [];
  const runner = new JobRunner({
    tools: [tool], qpdfPath: 'qpdf.exe', tempRoot: path.join(root, 'jobs'),
    onEvent: e => events.push(e), log: () => {},
    ...overrides,
  });
  return { root, runner, events, tool };
}

function argsFor(root, input = 'in.pdf') {
  return { toolId: 'fake', files: [path.join(root, input)], options: {}, outputDir: root };
}

function terminalEvents(events, id) {
  return events.filter(e => e.jobId === id && TERMINALS.has(e.type));
}

function jobDirs(root) {
  return fs.readdirSync(path.join(root, 'jobs'));
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

test('chạy tối đa 2 job đồng thời, job thứ ba nằm trong hàng đợi', async () => {
  let active = 0;
  let maxActive = 0;
  const releases = [];
  const { root, runner, events } = setup(ctx => new Promise(resolve => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    releases.push(() => {
      active -= 1;
      const out = path.join(ctx.tempDir, 'out.pdf');
      fs.writeFileSync(out, 'pdf');
      resolve({ outputs: [{ path: out }], errors: [] });
    });
  }));
  const ids = [0, 1, 2].map(() => runner.start(argsFor(root)));

  await waitFor(() => events.filter(e => e.type === 'started').length === 2);
  await new Promise(r => setTimeout(r, 150));
  assert.equal(events.filter(e => e.type === 'started').length, 2);
  assert.equal(events.some(e => e.jobId === ids[2] && e.type === 'started'), false);
  assert.equal(maxActive, 2);

  releases.shift()();
  await waitFor(() => events.filter(e => e.type === 'started').length === 3, 3000);
  assert.equal(maxActive, 2);

  while (releases.length) releases.shift()();
  await waitFor(() => events.filter(e => e.type === 'done').length === 3, 3000);
  assert.equal(maxActive, 2);
  for (const id of ids) assert.equal(terminalEvents(events, id).length, 1);
  await waitFor(() => jobDirs(root).length === 0, 3000);
  fs.rmSync(root, { recursive: true, force: true });
});

test('huỷ job trong hàng đợi phát đúng một cancelled và không started', async () => {
  const releases = [];
  const { root, runner, events } = setup(ctx => new Promise(resolve => {
    releases.push(() => {
      const out = path.join(ctx.tempDir, 'out.pdf');
      fs.writeFileSync(out, 'pdf');
      resolve({ outputs: [{ path: out }], errors: [] });
    });
  }));
  const first = runner.start(argsFor(root));
  const second = runner.start(argsFor(root));
  const third = runner.start(argsFor(root));

  assert.equal(events.some(e => e.jobId === third && e.type === 'queued'), true);
  assert.equal(events.some(e => e.jobId === third && e.type === 'started'), false);
  assert.equal(runner.cancel(third), true);
  assert.deepEqual(terminalEvents(events, third).map(e => e.type), ['cancelled']);
  assert.equal(events.some(e => e.jobId === third && e.type === 'started'), false);

  await waitFor(() => releases.length === 2);
  while (releases.length) releases.shift()();
  await waitFor(() => terminalEvents(events, first).length === 1 && terminalEvents(events, second).length === 1, 3000);
  await new Promise(r => setTimeout(r, 150));
  assert.equal(events.some(e => e.jobId === third && e.type === 'started'), false);
  assert.equal(terminalEvents(events, third).length, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test('dọn thư mục tạm sau thành công, lỗi và huỷ', async () => {
  const scenarios = [
    ['done', async ctx => {
      const out = path.join(ctx.tempDir, 'out.pdf');
      fs.writeFileSync(out, 'pdf');
      return { outputs: [{ path: out }] };
    }, null],
    ['error', async () => { throw new ToolError('INVALID_FILE', 'hỏng'); }, null],
    ['cancelled', () => new Promise(() => {}), (runner, id) => runner.cancel(id)],
  ];

  for (const [terminal, run, cancel] of scenarios) {
    const { root, runner, events } = setup(run);
    const id = runner.start(argsFor(root));
    if (cancel) {
      await waitFor(() => events.some(e => e.jobId === id && e.type === 'started'));
      assert.equal(cancel(runner, id), true);
    }
    await waitFor(() => events.some(e => e.jobId === id && e.type === terminal), 4000);
    await waitFor(() => jobDirs(root).length === 0, 3000);
    assert.equal(terminalEvents(events, id).length, 1);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('mỗi job chỉ phát đúng một terminal event', async () => {
  const { root, runner, events } = setup(async ctx => {
    if (ctx.files[0].endsWith('bad.pdf')) throw new ToolError('INVALID_FILE', 'hỏng');
    const out = path.join(ctx.tempDir, 'out.pdf');
    fs.writeFileSync(out, 'pdf');
    return { outputs: [{ path: out }] };
  });
  fs.writeFileSync(path.join(root, 'bad.pdf'), 'x');

  const ok = runner.start(argsFor(root, 'in.pdf'));
  const bad = runner.start(argsFor(root, 'bad.pdf'));
  const dropped = runner.start(argsFor(root, 'in.pdf'));
  assert.equal(runner.cancel(dropped), true);

  await waitFor(() => [ok, bad, dropped].every(id => terminalEvents(events, id).length === 1), 3000);
  await new Promise(r => setTimeout(r, 150));
  assert.deepEqual(terminalEvents(events, ok).map(e => e.type), ['done']);
  assert.deepEqual(terminalEvents(events, bad).map(e => e.type), ['error']);
  assert.deepEqual(terminalEvents(events, dropped).map(e => e.type), ['cancelled']);
  assert.equal(events.some(e => e.jobId === dropped && e.type === 'started'), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('đổi phase của progress không bị throttle bỏ mất', async () => {
  const { root, runner, events } = setup(async ctx => {
    ctx.progress('reading', 0, 1, 'đọc');
    ctx.progress('converting', 0, 3, 'chuyển');
    ctx.progress('converting', 1, 3, 'chuyển tiếp');
    const out = path.join(ctx.tempDir, 'out.pdf');
    fs.writeFileSync(out, 'pdf');
    return { outputs: [{ path: out }] };
  });
  const id = runner.start(argsFor(root));
  await waitFor(() => terminalEvents(events, id).length === 1);
  const progress = events.filter(e => e.jobId === id && e.type === 'progress');
  assert.equal(progress.some(e => e.phase === 'reading'), true);
  assert.equal(progress.some(e => e.phase === 'converting'), true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('bỏ qua progress phát sau khi job đã kết thúc', async () => {
  const { root, runner, events } = setup(async ctx => {
    const out = path.join(ctx.tempDir, 'out.pdf');
    fs.writeFileSync(out, 'pdf');
    setTimeout(() => ctx.progress('late', 0, 1, 'muộn'), 30);
    return { outputs: [{ path: out }] };
  });
  const id = runner.start(argsFor(root));
  await waitFor(() => events.some(e => e.jobId === id && e.type === 'done'));
  await new Promise(r => setTimeout(r, 120));
  assert.equal(events.some(e => e.jobId === id && e.type === 'progress' && e.phase === 'late'), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('output không tồn tại phát INTERNAL và không phát done', async () => {
  const { root, runner, events } = setup(async ctx => ({
    outputs: [{ path: path.join(ctx.tempDir, 'missing.pdf') }],
  }));
  const id = runner.start(argsFor(root));
  await waitFor(() => terminalEvents(events, id).length === 1);
  const terminal = terminalEvents(events, id);
  assert.deepEqual(terminal.map(e => e.type), ['error']);
  assert.equal(terminal[0].error.code, 'INTERNAL');
  assert.equal(events.some(e => e.jobId === id && e.type === 'done'), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('huỷ job có tool bỏ qua signal trong tối đa 2 giây', async () => {
  const { root, runner, events } = setup(() => new Promise(() => {}));
  const id = runner.start(argsFor(root));
  await waitFor(() => events.some(e => e.jobId === id && e.type === 'started'));

  const startedAt = Date.now();
  assert.equal(runner.cancel(id), true);
  await waitFor(() => events.some(e => e.jobId === id && e.type === 'cancelled'), 3000);
  const elapsed = Date.now() - startedAt;
  assert.ok(elapsed < 2000, `cancel mất ${elapsed}ms`);
  assert.equal(events.some(e => e.jobId === id && e.type === 'done'), false);
  assert.equal(terminalEvents(events, id).length, 1);
  await waitFor(() => jobDirs(root).length === 0, 3000);
  fs.rmSync(root, { recursive: true, force: true });
});

test('huỷ ngay sau start: tool thấy signal đã aborted và job chỉ cancelled', async () => {
  let sawAborted = false;
  const { root, runner, events } = setup(ctx => {
    sawAborted = ctx.signal.aborted;
    const out = path.join(ctx.tempDir, 'out.pdf');
    fs.writeFileSync(out, 'pdf');
    return { outputs: [{ path: out }] };
  });
  const id = runner.start(argsFor(root));
  assert.equal(runner.cancel(id), true);
  await waitFor(() => terminalEvents(events, id).length === 1);
  assert.equal(sawAborted, true);
  assert.deepEqual(terminalEvents(events, id).map(e => e.type), ['cancelled']);
  assert.equal(events.some(e => e.jobId === id && e.type === 'done'), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('log ném lỗi không làm hỏng terminal event', async () => {
  const { root, runner, events } = setup(async ctx => {
    ctx.log('xin chào');
    const out = path.join(ctx.tempDir, 'out.pdf');
    fs.writeFileSync(out, 'pdf');
    return { outputs: [{ path: out }] };
  }, { log: () => { throw new Error('log hỏng'); } });
  const id = runner.start(argsFor(root));
  await waitFor(() => terminalEvents(events, id).length === 1);
  assert.deepEqual(terminalEvents(events, id).map(e => e.type), ['done']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('không tạo được thư mục tạm vẫn phát đúng một lỗi', async () => {
  const { root, runner, events } = setup(async () => ({ outputs: [] }));
  fs.rmSync(path.join(root, 'jobs'), { recursive: true, force: true });
  const id = runner.start(argsFor(root));
  await waitFor(() => terminalEvents(events, id).length === 1);
  const terminal = terminalEvents(events, id);
  assert.deepEqual(terminal.map(e => e.type), ['error']);
  assert.equal(terminal[0].error.code, 'INTERNAL');
  fs.rmSync(root, { recursive: true, force: true });
});

test('onEvent trả promise bị lỗi không tạo unhandled rejection', async () => {
  const { root, runner, events } = setup(async ctx => {
    const out = path.join(ctx.tempDir, 'out.pdf');
    fs.writeFileSync(out, 'pdf');
    return { outputs: [{ path: out }] };
  }, {
    onEvent: e => {
      events.push(e);
      if (e.type === 'progress') return Promise.reject(new Error('listener hỏng'));
      return undefined;
    },
  });
  const id = runner.start(argsFor(root));
  await waitFor(() => events.some(e => e.jobId === id && e.type === 'done'));
  assert.equal(terminalEvents(events, id).filter(e => e.type === 'done').length, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

async function waitFor(fn, timeout = 2000) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error('timeout');
    await new Promise(r => setTimeout(r, 10));
  }
}
