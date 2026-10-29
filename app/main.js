// Trình sửa PDF – tiến trình chính (Electron)
const { app, BrowserWindow, ipcMain, dialog, protocol, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { listTools, getTools } = require('./suite/registry');
const { JobRunner } = require('./suite/jobs');
const { ToolError, toPayload } = require('./suite/errors');
const { binaryPath } = require('./suite/util/paths');
const { runProcess, killAllChildren } = require('./suite/util/spawn');
const { createLogger } = require('./suite/util/log');
const { registerRenderProtocol, pdfToImages, destroyRenderWorker } = require('./suite/render-worker');

const RENDERER = path.join(__dirname, 'renderer');
// Tên nội bộ ASCII: tên có dấu lọt vào User-Agent làm hỏng mọi yêu cầu tải tài nguyên
app.setName('TrinhSuaPDF');
app.userAgentFallback = app.userAgentFallback.replace(/[^\x20-\x7e]/g, '');
app.setPath('userData', path.join(app.getPath('appData'), 'TrinhSuaPDF'));
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: 'pdfsrc', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

let win = null;
let quitting = false;
let currentEntry = 'index.html';
let dirty = false;
let pendingFile = pdfFromArgv(process.argv);

function pdfFromArgv(argv) {
  const f = argv.slice(1).find(a => /\.pdf$/i.test(a) && !a.startsWith('--'));
  return f && fs.existsSync(f) ? path.resolve(f) : null;
}
function sigDir() { const d = path.join(app.getPath('userData'), 'signatures'); fs.mkdirSync(d, { recursive: true }); return d; }

// ----- Kiểm soát nguồn gọi IPC suite và đường dẫn được phép -----
// Chỉ khung chính của cửa sổ ứng dụng (home/editor) mới được gọi các kênh
// suite:*. So khớp tiền tố để chấp nhận hash router của shell (#/tool/...).
const ALLOWED_FRAME_URLS = ['app://local/index.html', 'app://local/editor.html'];
function isAllowedFrameUrl(url) {
  return typeof url === 'string'
    && ALLOWED_FRAME_URLS.some(base => url === base || url.startsWith(base + '#') || url.startsWith(base + '?'));
}
function assertMainFrame(event) {
  let ok = false;
  try {
    const frame = event?.senderFrame;
    ok = !!frame
      && event.sender === win?.webContents
      && frame.parent === null
      && isAllowedFrameUrl(frame.url);
  } catch { ok = false; }
  if (!ok) throw new ToolError('FORBIDDEN', 'Yêu cầu không hợp lệ.');
}
function guarded(handler) {
  return (event, ...args) => {
    assertMainFrame(event);
    return handler(event, ...args);
  };
}

// Danh sách đường dẫn do người dùng chọn qua hộp thoại/kéo-thả (hoặc do test
// đăng ký qua register-input). job-start/reveal chỉ nhận các đường dẫn này.
const allowedInputFiles = new Set();
const allowedRoots = new Set();
const pathKey = p => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
function addAllowedFile(p) {
  if (typeof p !== 'string' || !p) return;
  try {
    allowedInputFiles.add(pathKey(p));
    addAllowedRoot(path.dirname(path.resolve(p)));
  } catch { /* đường dẫn không hợp lệ: bỏ qua */ }
}
function addAllowedRoot(p) {
  if (typeof p !== 'string' || !p) return;
  try { allowedRoots.add(pathKey(p)); } catch { /* bỏ qua */ }
}
function isAllowedFile(p) {
  if (typeof p !== 'string' || !p) return false;
  try { return allowedInputFiles.has(pathKey(p)); } catch { return false; }
}
function isAllowedRoot(p) {
  if (typeof p !== 'string' || !p) return false;
  try { return allowedRoots.has(pathKey(p)); } catch { return false; }
}
function isUnderAllowedRoot(p) {
  if (typeof p !== 'string' || !p) return false;
  let key;
  try { key = pathKey(p); } catch { return false; }
  for (const root of allowedRoots) {
    const prefix = root.endsWith(path.sep) ? root : root + path.sep;
    if (key === root || key.startsWith(prefix)) return true;
  }
  return false;
}
function registerInputPath(p) {
  if (typeof p !== 'string' || !p) return;
  let isDir = false;
  try { isDir = fs.statSync(p).isDirectory(); } catch { /* file có thể chưa tồn tại; vẫn ghi nhận */ }
  if (isDir) addAllowedRoot(p); else addAllowedFile(p);
}
// Renderer chỉ được chạy job với file đã chọn và thư mục xuất đã chọn.
function assertJobPathsAllowed(req) {
  if (!req || typeof req !== 'object') throw new ToolError('INVALID_FILE', 'Yêu cầu không hợp lệ.');
  const files = Array.isArray(req.files) ? req.files : [];
  for (const f of files) {
    if (!isAllowedFile(f)) throw new ToolError('FORBIDDEN', 'File chưa được chọn trong ứng dụng.');
  }
  if (req.outputDir != null && !isAllowedRoot(req.outputDir)) {
    throw new ToolError('FORBIDDEN', 'Thư mục xuất chưa được chọn trong ứng dụng.');
  }
}

// Khi chạy kiểm thử tự động (TSP_NO_SINGLE_INSTANCE=1), bỏ khoá một-instance để
// test vẫn khởi động được dù người dùng đang mở sẵn ứng dụng.
const SKIP_LOCK = process.env.TSP_NO_SINGLE_INSTANCE === '1';
if (!SKIP_LOCK && !app.requestSingleInstanceLock()) { app.quit(); }
else {
  app.on('second-instance', (_e, argv) => {
    const f = pdfFromArgv(argv);
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    if (!f) return;
    if (currentEntry === 'editor.html') win.webContents.send('open-path', f);
    else openEditor(f);
  });
  app.whenReady().then(() => {
    protocol.handle('app', req => {
      const u = new URL(req.url); if (process.env.TSP_DEBUG) fs.appendFileSync(require('os').tmpdir() + '/tsp-debug.log', req.url + '\n');
      let p = path.normalize(path.join(RENDERER, decodeURIComponent(u.pathname)));
      if (!p.startsWith(RENDERER)) return new Response('forbidden', { status: 403 });
      const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf',
        '.json': 'application/json', '.png': 'image/png', '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream' };
      try {
        const body = fs.readFileSync(p);
        return new Response(body, { headers: { 'content-type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream' } });
      } catch { return new Response('not found', { status: 404 }); }
    });
    registerRenderProtocol();
    let healthCache = null;
    ipcMain.handle('suite:tools', guarded(() => listTools()));
    ipcMain.handle('suite:health', guarded(async () => {
      if (healthCache) return healthCache;
      const exe = binaryPath('qpdf.exe', {
        appRoot: __dirname, isPackaged: app.isPackaged, resourcesPath: process.resourcesPath,
      });
      try {
        const r = await runProcess(exe, ['--version']);
        healthCache = {
          qpdf: { ok: true, version: r.stdout.trim(), path: exe },
          tesseract: { ok: false, planned: true },
        };
      } catch (e) {
        healthCache = { qpdf: { ok: false, error: e.message, path: exe }, tesseract: { ok: false, planned: true } };
      }
      return healthCache;
    }));
    ipcMain.handle('suite:pick-files', guarded(async (_e, { accept = ['.pdf'], multiple = false } = {}) => {
      const r = await dialog.showOpenDialog(win, {
        title: 'Chọn file', properties: multiple ? ['openFile', 'multiSelections'] : ['openFile'],
        filters: [{ name: 'Tài liệu', extensions: accept.map(a => a.replace('.', '')) }],
      });
      if (r.canceled) return [];
      for (const f of r.filePaths) addAllowedFile(f);
      return r.filePaths;
    }));
    ipcMain.handle('suite:pick-output', guarded(async () => {
      const r = await dialog.showOpenDialog(win, { title: 'Chọn thư mục xuất', properties: ['openDirectory', 'createDirectory'] });
      if (r.canceled || !r.filePaths[0]) return null;
      addAllowedRoot(r.filePaths[0]);
      return r.filePaths[0];
    }));
    ipcMain.handle('suite:register-input', guarded((_e, paths) => {
      if (Array.isArray(paths)) for (const p of paths.slice(0, 100)) registerInputPath(p);
      return true;
    }));
    ipcMain.handle('suite:reveal', guarded((_e, p) => {
      if (!isUnderAllowedRoot(p) || !fs.existsSync(p)) return false;
      if (fs.statSync(p).isDirectory()) shell.openPath(p);
      else shell.showItemInFolder(p);
      return true;
    }));
    const logFile = path.join(app.getPath('userData'), 'logs', 'tools.log');
    const log = createLogger(logFile);
    const runner = new JobRunner({
      tools: getTools(),
      qpdfPath: binaryPath('qpdf.exe', {
        appRoot: __dirname, isPackaged: app.isPackaged, resourcesPath: process.resourcesPath,
      }),
      tempRoot: path.join(app.getPath('temp'), 'TrinhSuaPDF', 'jobs'),
      log,
      render: { pdfToImages },
      onEvent: ev => { if (win && !win.isDestroyed()) win.webContents.send('suite:job-event', ev); },
    });
    ipcMain.handle('suite:job-start', (event, req) => {
      try {
        assertMainFrame(event);
        assertJobPathsAllowed(req);
        return { ok: true, jobId: runner.start(req) };
      } catch (e) {
        log(`job-start rejected: ${e.stack || e.message}`);
        return { ok: false, error: toPayload(e) };
      }
    });
    ipcMain.handle('suite:job-cancel', guarded((_e, { jobId } = {}) => runner.cancel(jobId)));
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
  // Dừng qpdf/tiến trình con còn sống trước khi thoát (không để orphan trên Windows).
  app.on('before-quit', () => { quitting = true; destroyRenderWorker(); killAllChildren(); });
}

function startEntry() {
  if (pendingFile) return 'editor.html';
  if (process.env.TSP_SUITE === '1') return 'index.html';
  // Giữ nguyên hành vi các bộ test cũ: không truyền file thì mở editor.
  if (process.env.TSP_NO_SINGLE_INSTANCE === '1') return 'editor.html';
  return 'index.html';
}

function loadEntry(entry) {
  currentEntry = entry;
  win.loadURL('app://local/' + entry);
}

function openEditor(p) {
  if (typeof p === 'string' && fs.existsSync(p)) pendingFile = p;
  loadEntry('editor.html');
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 900, minHeight: 600,
    title: 'Trình sửa PDF', backgroundColor: '#e9edf3', show: false,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  win.setMenu(null);
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  if (process.env.TSP_DEBUG) win.webContents.on('console-message', (_e, lvl, msg, line, src) => fs.appendFileSync(require('os').tmpdir() + '/tsp-debug.log', `[console ${lvl}] ${msg} (${src}:${line})\n`));
  loadEntry(startEntry());
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', e => e.preventDefault());
  // Worker render là cửa sổ ẩn duy nhất ngoài win; đóng win phải dọn nó và
  // thoát hẳn — window-all-closed không tự phát khi worker bị destroy sau đó.
  win.on('closed', () => {
    win = null;
    destroyRenderWorker();
    if (!quitting) app.quit();
  });
  win.on('close', e => {
    if (!dirty) return;
    const r = dialog.showMessageBoxSync(win, {
      type: 'warning', buttons: ['Thoát, không lưu', 'Quay lại'], defaultId: 1, cancelId: 1,
      title: 'Chưa lưu', message: 'Bạn có thay đổi chưa lưu.', detail: 'Nếu thoát bây giờ, các chỉnh sửa sẽ bị mất.',
    });
    if (r === 1) e.preventDefault();
  });
}

function readPdf(p) { return { path: p, name: path.basename(p), data: new Uint8Array(fs.readFileSync(p)) }; }

ipcMain.handle('initial-file', () => { const f = pendingFile; pendingFile = null; return f ? readPdf(f) : null; });
ipcMain.handle('read-pdf', (_e, p) => readPdf(p));
ipcMain.handle('open-pdf-dialog', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Mở file PDF', properties: ['openFile'], filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  return r.canceled || !r.filePaths[0] ? null : readPdf(r.filePaths[0]);
});
ipcMain.handle('save-pdf', async (_e, { data, path: target, defaultPath }) => {
  if (!target) {
    const r = await dialog.showSaveDialog(win, { title: 'Lưu PDF', defaultPath, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (r.canceled || !r.filePath) return null;
    target = /\.pdf$/i.test(r.filePath) ? r.filePath : r.filePath + '.pdf';
  }
  fs.writeFileSync(target, Buffer.from(data));
  return target;
});
ipcMain.handle('set-dirty', (_e, d) => { dirty = !!d; });
ipcMain.handle('show-in-folder', (_e, p) => shell.showItemInFolder(p));
// Thư viện chữ ký (lưu trong thư mục dữ liệu ứng dụng)
ipcMain.handle('sig-list', () => fs.readdirSync(sigDir()).filter(f => f.endsWith('.png')).sort().reverse()
  .map(f => ({ id: f.replace(/\.png$/, ''), dataUrl: 'data:image/png;base64,' + fs.readFileSync(path.join(sigDir(), f)).toString('base64') })));
ipcMain.handle('sig-save', (_e, dataUrl) => {
  const id = 'sig-' + Date.now();
  fs.writeFileSync(path.join(sigDir(), id + '.png'), Buffer.from(dataUrl.split(',')[1], 'base64'));
  return id;
});
ipcMain.handle('sig-delete', (_e, id) => { const f = path.join(sigDir(), path.basename(id) + '.png'); if (fs.existsSync(f)) fs.unlinkSync(f); });

// Phiên chỉnh sửa: file phụ "<tên>.tsp.json" nằm cạnh PDF gốc, giữ lại các đối tượng đã
// thêm/sửa để lần sau mở lại vẫn chỉnh tiếp được (PDF đã lưu là bản "nướng", không sửa lại được).
const sessionPathOf = p => (typeof p === 'string' && p ? p.replace(/\.pdf$/i, '') + '.tsp.json' : null);
ipcMain.handle('session-read', (_e, pdfPath) => {
  const f = sessionPathOf(pdfPath);
  if (!f || !fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
});
ipcMain.handle('session-write', (_e, pdfPath, data) => {
  const f = sessionPathOf(pdfPath);
  if (!f) return null;
  fs.writeFileSync(f, JSON.stringify(data));
  return f;
});
ipcMain.handle('session-delete', (_e, pdfPath) => {
  const f = sessionPathOf(pdfPath);
  if (f && fs.existsSync(f)) fs.unlinkSync(f);
  return f;
});

// Điều hướng giữa trang chủ và trình sửa (dùng cho shell suite ở các task sau).
// `dirty` chỉ được xoá khi renderer xác nhận người dùng đã đồng ý bỏ thay đổi.
ipcMain.handle('suite:go-home', guarded((_e, opts) => {
  if (opts?.confirmed === true) dirty = false;
  loadEntry('index.html');
  return true;
}));
ipcMain.handle('suite:open-editor', guarded((_e, p) => { openEditor(p); return true; }));
