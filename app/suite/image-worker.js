const { BrowserWindow, ipcMain, protocol } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Readable } = require('node:stream');
const { ToolError } = require('./errors');

const IMAGE_URL = 'app://local/worker/image.html';
const WORKER_START_TIMEOUT_MS = 15000;
// Cạnh dài tối đa của ảnh sau giải mã (giống giới hạn của PDF → ảnh).
const MAX_IMAGE_EDGE = 10000;
const DEFAULT_TEMP_ROOT = path.join(os.tmpdir(), 'TrinhSuaPDF', 'image-worker');
const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

// Token nguồn chỉ sống trong lúc một task chạy; worker chỉ biết
// imgsrc://<token>/image, không bao giờ nhận đường dẫn hay byte ảnh qua IPC.
const sources = new Map();
const tasks = new Map();
let worker = null;
let ready = null;
let protocolRegistered = false;
let chain = Promise.resolve();

function decodeFailed() {
  return new ToolError('INVALID_FILE', 'Không đọc được ảnh.');
}

function workerFailed() {
  return new ToolError('INTERNAL', 'Không xử lý được ảnh.');
}

function registerImageProtocol() {
  if (protocolRegistered) return;
  protocolRegistered = true;
  protocol.handle('imgsrc', req => {
    let token = '';
    try { token = new URL(req.url).hostname; } catch { /* URL hỏng */ }
    const file = token ? sources.get(token) : null;
    let stat = null;
    try { stat = file ? fs.statSync(file) : null; } catch { /* file đã bị xoá */ }
    const type = file ? MIME_BY_EXT[path.extname(file).toLowerCase()] : null;
    if (!stat?.isFile() || !type) return new Response('forbidden', { status: 403 });
    return new Response(Readable.toWeb(fs.createReadStream(file)), {
      headers: {
        'content-type': type,
        'content-length': String(stat.size),
        'access-control-allow-origin': '*',
      },
    });
  });
}

function settleTask(id, error, result) {
  const task = tasks.get(id);
  if (!task) return;
  tasks.delete(id);
  sources.delete(task.token);
  if (task.signal && task.onAbort) task.signal.removeEventListener('abort', task.onAbort);
  if (error) task.reject(error);
  else task.resolve(result);
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
      preload: path.join(__dirname, 'image-worker-preload.js'),
      contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
    },
  });
  worker = w;
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate', e => e.preventDefault());

  // ready chỉ resolve sau khi image.js đăng ký onTask xong; main không bao giờ
  // gửi task trước đó. did-fail-load/timeout/closed đều reject để job báo lỗi.
  ready = new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ipcMain.removeListener('image:ready', onReady);
      w.webContents.removeListener('did-fail-load', onFail);
      w.removeListener('closed', onClosed);
      fn(value);
    };
    const onReady = event => {
      if (event.sender === w.webContents) finish(resolve, w);
    };
    const onFail = (_e, code, desc) => finish(reject, new Error(`image worker load failed (${code}): ${desc}`));
    const onClosed = () => finish(reject, new Error('image worker closed before ready'));
    ipcMain.on('image:ready', onReady);
    w.webContents.once('did-fail-load', onFail);
    w.once('closed', onClosed);
    timer = setTimeout(() => finish(reject, new Error('image worker start timed out')), WORKER_START_TIMEOUT_MS);
    w.loadURL(IMAGE_URL).catch(e => finish(reject, e));
  });
  ready.catch(() => { /* lỗi được chuyển cho task đang chờ trong imageToPng */ });

  w.on('closed', () => {
    if (worker === w) { worker = null; ready = null; }
    failAllPending(workerFailed());
  });
  w.webContents.on('render-process-gone', () => {
    failAllPending(workerFailed());
    if (worker === w) resetWorker();
  });
  w.on('unresponsive', () => {
    failAllPending(workerFailed());
    if (worker === w) resetWorker();
  });
  return ready;
}

function isWorkerSender(event) {
  return !!worker && !worker.isDestroyed() && event.sender === worker.webContents;
}

ipcMain.on('image:done', (event, msg) => {
  if (!isWorkerSender(event) || !msg) return;
  const task = tasks.get(msg.taskId);
  if (!task) return;
  if (
    !ArrayBuffer.isView(msg.bytes) || !msg.bytes.byteLength
    || !Number.isInteger(msg.width) || msg.width < 1 || msg.width > MAX_IMAGE_EDGE
    || !Number.isInteger(msg.height) || msg.height < 1 || msg.height > MAX_IMAGE_EDGE
  ) {
    settleTask(msg.taskId, decodeFailed());
    resetWorker();
    return;
  }
  const file = path.join(task.outDir, `image-${msg.taskId}.png`);
  try {
    fs.mkdirSync(task.outDir, { recursive: true });
    fs.writeFileSync(file, Buffer.from(msg.bytes.buffer, msg.bytes.byteOffset, msg.bytes.byteLength), { flag: 'wx' });
  } catch {
    settleTask(msg.taskId, new ToolError('INTERNAL', 'Không ghi được ảnh tạm.'));
    resetWorker();
    return;
  }
  settleTask(msg.taskId, null, { path: file, width: msg.width, height: msg.height });
});

ipcMain.on('image:error', (event, msg) => {
  if (!isWorkerSender(event) || !msg) return;
  const task = tasks.get(msg.taskId);
  if (!task) return;
  settleTask(msg.taskId, decodeFailed());
});

function imageToPng(filePath, opts = {}) {
  const run = () => {
    if (opts.signal?.aborted) return Promise.reject(new ToolError('CANCELLED', 'Đã huỷ'));
    return new Promise((resolve, reject) => {
      const token = randomUUID();
      const id = randomUUID();
      const task = {
        id, token, outDir: opts.outDir || DEFAULT_TEMP_ROOT,
        signal: opts.signal, onAbort: null, resolve, reject,
      };
      sources.set(token, filePath);
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
        if (w.isDestroyed() || worker !== w) throw new Error('image worker unavailable');
        w.webContents.send('image:task', {
          id,
          url: `imgsrc://${token}/image`,
          maxEdge: MAX_IMAGE_EDGE,
        });
      }).catch(() => {
        if (!tasks.has(id)) return;
        settleTask(id, workerFailed());
        resetWorker();
      });
    });
  };
  const p = chain.then(run, run);
  chain = p.catch(() => { /* giữ chuỗi ảnh tuần tự kể cả khi task lỗi */ });
  return p;
}

function destroyImageWorker() {
  resetWorker();
  try { fs.rmSync(DEFAULT_TEMP_ROOT, { recursive: true, force: true }); } catch { /* đang dùng */ }
}

module.exports = { registerImageProtocol, imageToPng, destroyImageWorker };
