const { BrowserWindow, ipcMain, protocol } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Readable } = require('node:stream');
const { ToolError } = require('./errors');

const RENDER_URL = 'app://local/worker/render.html';
const WORKER_START_TIMEOUT_MS = 15000;

// Token nguồn chỉ tồn tại trong lúc một task đang chạy. Worker chỉ biết URL
// pdfsrc://<token>/doc.pdf, không bao giờ nhận đường dẫn hay byte PDF qua IPC.
const sources = new Map();
const tasks = new Map();
let worker = null;
let ready = null;
let protocolRegistered = false;
let chain = Promise.resolve();

function renderFailed() {
  return new ToolError('RENDER_FAILED', 'Không render được trang PDF.');
}

function registerRenderProtocol() {
  if (protocolRegistered) return;
  protocolRegistered = true;
  protocol.handle('pdfsrc', req => {
    let token = '';
    try { token = new URL(req.url).hostname; } catch { /* URL hỏng */ }
    const file = token ? sources.get(token) : null;
    let stat = null;
    try { stat = file ? fs.statSync(file) : null; } catch { /* file đã bị xoá */ }
    if (!stat?.isFile()) return new Response('forbidden', { status: 403 });
    return new Response(Readable.toWeb(fs.createReadStream(file)), {
      headers: {
        'content-type': 'application/pdf',
        'content-length': String(stat.size),
        'access-control-allow-origin': '*',
      },
    });
  });
}

function settleTask(id, error) {
  const task = tasks.get(id);
  if (!task) return;
  tasks.delete(id);
  sources.delete(task.token);
  if (task.signal && task.onAbort) task.signal.removeEventListener('abort', task.onAbort);
  if (error) task.reject(error);
  else task.resolve(task.files);
}

function failAllPending(error) {
  for (const id of [...tasks.keys()]) settleTask(id, error);
}

function resetWorker() {
  const old = worker;
  worker = null;
  ready = null;
  if (old && !old.isDestroyed()) {
    try { old.destroy(); } catch { /* cửa sổ có thể đã chết */ }
  }
}

function ensureWorker() {
  if (worker && !worker.isDestroyed()) return ready || Promise.resolve(worker);

  const w = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'worker-preload.js'),
      contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
    },
  });
  worker = w;
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate', e => e.preventDefault());

  // ready chỉ resolve sau khi render.js gọi workerApi.ready() — tức onTask đã
  // đăng ký. did-fail-load/timeout/closed đều reject để job báo lỗi thay vì treo.
  ready = new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ipcMain.removeListener('render:ready', onReady);
      w.webContents.removeListener('did-fail-load', onFail);
      w.removeListener('closed', onClosed);
      fn(value);
    };
    const onReady = event => {
      if (event.sender === w.webContents) finish(resolve, w);
    };
    const onFail = (_e, code, desc) => finish(reject, new Error(`render worker load failed (${code}): ${desc}`));
    const onClosed = () => finish(reject, new Error('render worker closed before ready'));
    ipcMain.on('render:ready', onReady);
    w.webContents.once('did-fail-load', onFail);
    w.once('closed', onClosed);
    timer = setTimeout(() => finish(reject, new Error('render worker start timed out')), WORKER_START_TIMEOUT_MS);
    w.loadURL(RENDER_URL).catch(e => finish(reject, e));
  });
  ready.catch(() => { /* lỗi được chuyển cho task đang chờ trong pdfToImages */ });

  w.on('closed', () => {
    if (worker === w) { worker = null; ready = null; }
    failAllPending(renderFailed());
  });
  w.webContents.on('render-process-gone', () => {
    failAllPending(renderFailed());
    if (worker === w) resetWorker();
  });
  w.on('unresponsive', () => {
    failAllPending(renderFailed());
    if (worker === w) resetWorker();
  });
  return ready;
}

function isWorkerSender(event) {
  return !!worker && !worker.isDestroyed() && event.sender === worker.webContents;
}

ipcMain.on('render:page', (event, msg) => {
  if (!isWorkerSender(event) || !msg) return;
  const task = tasks.get(msg.taskId);
  if (!task) return;
  if (!Number.isInteger(msg.page) || !task.pages.includes(msg.page)) return;
  if (!ArrayBuffer.isView(msg.bytes) || !msg.bytes.byteLength) {
    settleTask(msg.taskId, renderFailed());
    resetWorker();
    return;
  }
  const file = path.join(task.outDir, `render-${msg.page}.${task.format}`);
  try {
    fs.writeFileSync(file, Buffer.from(msg.bytes.buffer, msg.bytes.byteOffset, msg.bytes.byteLength));
  } catch (e) {
    settleTask(msg.taskId, new ToolError('INTERNAL', 'Không ghi được ảnh render.'));
    resetWorker();
    return;
  }
  task.files.push({ page: msg.page, path: file });
});

ipcMain.on('render:progress', (event, msg) => {
  if (!isWorkerSender(event) || !msg) return;
  const task = tasks.get(msg.taskId);
  if (!task || !Number.isInteger(msg.current) || !Number.isInteger(msg.total)) return;
  try { task.progress?.(msg.current, msg.total); } catch { /* tiến trình không được làm hỏng task */ }
});

ipcMain.on('render:done', (event, msg) => {
  if (!isWorkerSender(event) || !msg) return;
  const task = tasks.get(msg.taskId);
  if (!task) return;
  settleTask(msg.taskId, msg.error ? renderFailed() : null);
});

function pdfToImages(opts) {
  const run = () => {
    if (opts.signal?.aborted) return Promise.reject(new ToolError('CANCELLED', 'Đã huỷ'));
    return new Promise((resolve, reject) => {
      const token = randomUUID();
      const id = randomUUID();
      const task = {
        id, token, format: opts.format, outDir: opts.outDir, pages: opts.pages,
        files: [], signal: opts.signal, onAbort: null, progress: opts.progress, resolve, reject,
      };
      sources.set(token, opts.filePath);
      tasks.set(id, task);

      const onAbort = () => {
        if (!tasks.has(id)) return;
        settleTask(id, new ToolError('CANCELLED', 'Đã huỷ'));
        resetWorker();
      };
      task.onAbort = onAbort;
      if (opts.signal) {
        opts.signal.addEventListener('abort', onAbort, { once: true });
        // Signal có thể đã aborted ngay trước khi gắn listener.
        if (opts.signal.aborted) return onAbort();
      }

      ensureWorker().then(w => {
        // Task bị huỷ/fail trong lúc chờ worker: không gửi task nữa.
        if (!tasks.has(id)) return;
        if (w.isDestroyed() || worker !== w) throw new Error('render worker unavailable');
        w.webContents.send('render:task', {
          id,
          url: `pdfsrc://${token}/doc.pdf`,
          pages: opts.pages,
          dpi: opts.dpi,
          format: opts.format,
          quality: opts.quality,
        });
      }).catch(() => {
        if (!tasks.has(id)) return;
        settleTask(id, renderFailed());
        resetWorker();
      });
    });
  };
  const p = chain.then(run, run);
  chain = p.catch(() => { /* giữ chuỗi render tuần tự kể cả khi task lỗi */ });
  return p;
}

function destroyRenderWorker() {
  resetWorker();
}

module.exports = { registerRenderProtocol, pdfToImages, destroyRenderWorker };
