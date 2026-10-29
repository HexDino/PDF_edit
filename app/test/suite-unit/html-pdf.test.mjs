import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { htmlTool } = require('../../suite/pdfops/html-pdf.js');
const { JobRunner } = require('../../suite/jobs.js');
const { ToolError } = require('../../suite/errors.js');

const PDF = Buffer.from('%PDF-1.4\n% html\n');
const PRINTED = { buffer: PDF, blocked: 0 };
const TERMINALS = new Set(['done', 'error', 'cancelled']);

function setup(t, name = 'trang.html') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsp-html-'));
  const file = path.join(root, name);
  fs.writeFileSync(file, '<!doctype html><html><body>xin chào</body></html>');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, file };
}

function makeCtx(root, file, { options = {}, printHtml = null, signal, outputDir = root } = {}) {
  const tempDir = fs.mkdtempSync(path.join(root, 'tmp-'));
  const ctx = {
    files: [file],
    options,
    outputDir,
    tempDir,
    signal: signal || new AbortController().signal,
    progress: () => {},
  };
  if (printHtml) ctx.printHtml = printHtml;
  return ctx;
}

async function waitFor(fn, timeout = 4000) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error('timeout');
    await new Promise(r => setTimeout(r, 10));
  }
}

test('html-pdf chuyển tuỳ chọn mặc định và xuất <base>-html.pdf', async t => {
  const { root, file } = setup(t);
  const calls = [];
  const ctx = makeCtx(root, file, {
    printHtml: async opts => { calls.push(opts); return PRINTED; },
  });
  const result = await htmlTool(ctx);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].filePath, file);
  assert.equal(calls[0].pageSize, 'A4');
  assert.equal(calls[0].landscape, false);
  assert.equal(calls[0].printBackground, true);
  assert.equal(calls[0].marginMm, 10);
  assert.equal(calls[0].signal, ctx.signal);

  assert.equal(result.outputs.length, 1);
  assert.equal(path.basename(result.outputs[0].path), 'trang-html.pdf');
  assert.equal(path.dirname(path.resolve(result.outputs[0].path)), path.resolve(root));
  assert.deepEqual(fs.readFileSync(result.outputs[0].path), PDF);
  assert.deepEqual(result.errors, [], 'không có tài nguyên mạng thì không cảnh báo');
  assert.equal(result.stats.blocked, 0);
  assert.deepEqual(fs.readdirSync(ctx.tempDir), [], 'không còn file tạm sau khi xuất');
});

test('html-pdf báo NETWORK_BLOCKED nhưng vẫn xuất PDF khi tài nguyên mạng bị chặn', async t => {
  const { root, file } = setup(t, 'co-anh-mang.html');
  const result = await htmlTool(makeCtx(root, file, {
    printHtml: async () => ({ buffer: PDF, blocked: 3 }),
  }));

  assert.equal(result.outputs.length, 1);
  const out = result.outputs[0].path;
  assert.equal(path.basename(out), 'co-anh-mang-html.pdf');
  assert.deepEqual(fs.readFileSync(out), PDF, 'PDF vẫn được tạo dù có cảnh báo');
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].code, 'NETWORK_BLOCKED');
  assert.equal(result.errors[0].file, file);
  assert.match(result.errors[0].message, /Đã chặn tài nguyên mạng/);
  assert.equal(result.errors[0].message.includes(root), false, 'không lộ đường dẫn trong cảnh báo');
  assert.equal(result.stats.blocked, 3);
});

test('html-pdf chuyển đúng tuỳ chọn khổ/ngang/nền/lề', async t => {
  const { root, file } = setup(t, 'bai-viet.htm');
  const calls = [];
  await htmlTool(makeCtx(root, file, {
    options: { pageSize: 'A3', landscape: true, printBackground: false, margin: 0 },
    printHtml: async opts => { calls.push(opts); return PRINTED; },
  }));
  assert.deepEqual(
    [calls[0].pageSize, calls[0].landscape, calls[0].printBackground, calls[0].marginMm],
    ['A3', true, false, 0],
  );
});

test('html-pdf không ghi đè: lần hai nhận tên (2), file đầu giữ nguyên', async t => {
  const { root, file } = setup(t);
  const first = path.join(root, 'trang-html.pdf');
  fs.writeFileSync(first, 'ban cu');
  const result = await htmlTool(makeCtx(root, file, { printHtml: async () => PRINTED }));
  assert.equal(path.basename(result.outputs[0].path), 'trang-html (2).pdf');
  assert.equal(fs.readFileSync(first, 'utf8'), 'ban cu');
});

test('html-pdf xuất vào outputDir khi được chọn', async t => {
  const { root, file } = setup(t);
  const outDir = path.join(root, 'dau-ra');
  fs.mkdirSync(outDir);
  const result = await htmlTool(makeCtx(root, file, {
    outputDir: outDir, printHtml: async () => PRINTED,
  }));
  assert.equal(path.dirname(path.resolve(result.outputs[0].path)), path.resolve(outDir));
});

test('html-pdf từ chối file không phải .html/.htm', async t => {
  const { root } = setup(t);
  const txt = path.join(root, 'ghi-chu.txt');
  fs.writeFileSync(txt, 'x');
  await assert.rejects(
    htmlTool(makeCtx(root, txt, { printHtml: async () => PRINTED })),
    e => e.code === 'INVALID_FILE',
  );
});

test('html-pdf từ chối khi thiếu file', async t => {
  const { root } = setup(t);
  const ctx = makeCtx(root, path.join(root, 'trang.html'), { printHtml: async () => PRINTED });
  ctx.files = [];
  await assert.rejects(htmlTool(ctx), e => e.code === 'INVALID_FILE');
});

test('html-pdf báo INTERNAL khi thiếu dịch vụ in', async t => {
  const { root, file } = setup(t);
  await assert.rejects(htmlTool(makeCtx(root, file)), e => e.code === 'INTERNAL');
});

test('html-pdf chuyển tiếp lỗi ToolError của dịch vụ in', async t => {
  const { root, file } = setup(t);
  await assert.rejects(
    htmlTool(makeCtx(root, file, {
      printHtml: async () => { throw new ToolError('INVALID_FILE', 'Không đọc được file HTML.'); },
    })),
    e => e.code === 'INVALID_FILE' && e.message === 'Không đọc được file HTML.',
  );
});

test('html-pdf giữ mã CANCELLED của dịch vụ in', async t => {
  const { root, file } = setup(t);
  await assert.rejects(
    htmlTool(makeCtx(root, file, {
      printHtml: async () => { throw new ToolError('CANCELLED', 'Đã huỷ'); },
    })),
    e => e.code === 'CANCELLED',
  );
});

test('html-pdf bọc lỗi lạ thành INTERNAL để không lộ chi tiết', async t => {
  const { root, file } = setup(t);
  await assert.rejects(
    htmlTool(makeCtx(root, file, {
      printHtml: async () => { throw new Error('C:\\bi-mat\\trang.html in hỏng'); },
    })),
    e => e.code === 'INTERNAL' && !e.message.includes('bi-mat'),
  );
});

test('html-pdf từ chối buffer rỗng hoặc không phải PDF', async t => {
  const { root, file } = setup(t);
  for (const printed of [
    { buffer: Buffer.alloc(0), blocked: 0 },
    { buffer: Buffer.from('không phải pdf'), blocked: 0 },
    { buffer: Buffer.from('không phải pdf') },
    null,
  ]) {
    await assert.rejects(
      htmlTool(makeCtx(root, file, { printHtml: async () => printed })),
      e => e.code === 'INTERNAL',
    );
  }
  assert.deepEqual(fs.readdirSync(root).filter(n => n.endsWith('.pdf')), []);
});

test('html-pdf tôn trọng signal đã huỷ trước khi in', async t => {
  const { root, file } = setup(t);
  let called = 0;
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    htmlTool(makeCtx(root, file, {
      signal: controller.signal,
      printHtml: async () => { called += 1; return PRINTED; },
    })),
    e => e.name === 'AbortError' || e.code === 'CANCELLED',
  );
  assert.equal(called, 0);
});

test('html-pdf huỷ ngay sau khi in xong không xuất file', async t => {
  const { root, file } = setup(t);
  const controller = new AbortController();
  const ctx = makeCtx(root, file, {
    signal: controller.signal,
    printHtml: async () => { controller.abort(); return PRINTED; },
  });
  await assert.rejects(
    htmlTool(ctx),
    e => e.name === 'AbortError' || e.code === 'CANCELLED',
  );
  assert.deepEqual(fs.readdirSync(root).filter(n => n.endsWith('.pdf')), []);
});

test('html-pdf từ chối tuỳ chọn sai và không gọi dịch vụ in', async t => {
  const { root, file } = setup(t);
  const invalid = [
    { pageSize: 'B5' },
    { pageSize: 4 },
    { margin: -1 },
    { margin: 51 },
    { margin: 1.5 },
    { landscape: 'yes' },
    { printBackground: 1 },
  ];
  let called = 0;
  for (const options of invalid) {
    await assert.rejects(
      htmlTool(makeCtx(root, file, {
        options,
        printHtml: async () => { called += 1; return PRINTED; },
      })),
      e => e.code === 'INVALID_OPTIONS',
      JSON.stringify(options),
    );
  }
  assert.equal(called, 0);
});

test('JobRunner tiêm printHtml với signal của job và thắng signal lạ', async t => {
  const { root, file } = setup(t);
  const events = [];
  const foreign = new AbortController();
  let seen = null;
  const runner = new JobRunner({
    tools: [{
      id: 'fake-html', status: 'available', multiple: false, accept: ['.html'], options: [],
      run: async ctx => {
        const printed = await ctx.printHtml({
          filePath: file, pageSize: 'A3', marginMm: 5, signal: foreign.signal,
        });
        const out = path.join(ctx.tempDir, 'out.pdf');
        fs.writeFileSync(out, printed.buffer);
        return { outputs: [{ path: out }] };
      },
    }],
    qpdfPath: 'qpdf.exe',
    tempRoot: path.join(root, 'jobs'),
    onEvent: e => events.push(e),
    log: () => {},
    printHtml: async opts => { seen = opts; return PRINTED; },
  });
  const id = runner.start({ toolId: 'fake-html', files: [file], options: {}, outputDir: root });
  await waitFor(() => events.some(e => e.jobId === id && TERMINALS.has(e.type)));
  const terminal = events.find(e => e.jobId === id && TERMINALS.has(e.type));
  assert.equal(terminal.type, 'done');
  assert.ok(seen && typeof seen === 'object');
  assert.equal(seen.pageSize, 'A3');
  assert.equal(seen.marginMm, 5);
  assert.notEqual(seen.signal, foreign.signal);
  assert.ok(seen.signal instanceof AbortSignal);
  assert.equal(seen.signal.aborted, false);
});

test('JobRunner huỷ job làm abort signal của printHtml', async t => {
  const { root, file } = setup(t);
  const events = [];
  let signalSeen = null;
  const runner = new JobRunner({
    tools: [{
      id: 'fake-html', status: 'available', multiple: false, accept: ['.html'], options: [],
      run: ctx => ctx.printHtml({ filePath: file }),
    }],
    qpdfPath: 'qpdf.exe',
    tempRoot: path.join(root, 'jobs'),
    onEvent: e => events.push(e),
    log: () => {},
    printHtml: opts => new Promise((_resolve, reject) => {
      signalSeen = opts.signal;
      opts.signal.addEventListener('abort', () => reject(new ToolError('CANCELLED', 'Đã huỷ')));
    }),
  });
  const id = runner.start({ toolId: 'fake-html', files: [file], options: {}, outputDir: root });
  await waitFor(() => events.some(e => e.jobId === id && e.type === 'started'));
  assert.equal(runner.cancel(id), true);
  await waitFor(() => events.some(e => e.jobId === id && e.type === 'cancelled'));
  assert.equal(signalSeen.aborted, true);
  assert.equal(events.some(e => e.jobId === id && e.type === 'done'), false);
});
