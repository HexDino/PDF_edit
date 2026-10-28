// Trình sửa PDF – tiến trình chính (Electron)
const { app, BrowserWindow, ipcMain, dialog, protocol, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const RENDERER = path.join(__dirname, 'renderer');
// Tên nội bộ ASCII: tên có dấu lọt vào User-Agent làm hỏng mọi yêu cầu tải tài nguyên
app.setName('TrinhSuaPDF');
app.userAgentFallback = app.userAgentFallback.replace(/[^\x20-\x7e]/g, '');
app.setPath('userData', path.join(app.getPath('appData'), 'TrinhSuaPDF'));
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

let win = null;
let currentEntry = 'index.html';
let dirty = false;
let pendingFile = pdfFromArgv(process.argv);

function pdfFromArgv(argv) {
  const f = argv.slice(1).find(a => /\.pdf$/i.test(a) && !a.startsWith('--'));
  return f && fs.existsSync(f) ? path.resolve(f) : null;
}
function sigDir() { const d = path.join(app.getPath('userData'), 'signatures'); fs.mkdirSync(d, { recursive: true }); return d; }

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
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
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
ipcMain.handle('suite:go-home', () => { dirty = false; loadEntry('index.html'); return true; });
ipcMain.handle('suite:open-editor', (_e, p) => { openEditor(p); return true; });
