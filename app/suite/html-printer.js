const { BrowserWindow, session } = require('electron');
const { pathToFileURL } = require('node:url');
const { ToolError } = require('./errors');

// Session riêng, không persist: HTML được in không dùng chung cookie/cache với
// cửa sổ ứng dụng, và mọi request mạng trong session này đều bị huỷ.
const PARTITION = 'html-print';
const PAGE_SIZES = new Set(['A4', 'A3', 'Letter']);
const LOAD_TIMEOUT_MS = 20000;
const FONT_TIMEOUT_MS = 5000;
const PRINT_TIMEOUT_MS = 30000;
// Chờ thêm một nhịp ngắn sau khi font sẵn sàng để layout ổn định trước khi in.
const SETTLE_MS = 100;

let printSession = null;
let chain = Promise.resolve();
const openWindows = new Set();
// Số request mạng bị chặn theo webContents của từng cửa sổ in. Mỗi lần in đọc
// con số này trước khi đóng cửa sổ để báo cho người dùng biết PDF có thể thiếu.
const blockedByWindow = new Map();

function cancelled() {
  return new ToolError('CANCELLED', 'Đã huỷ');
}

function invalidHtml() {
  return new ToolError('INVALID_FILE', 'Không đọc được file HTML.');
}

function printFailed() {
  return new ToolError('INTERNAL', 'Không in được HTML.');
}

// Bao một promise bằng tín hiệu huỷ để bước đang chờ kết thúc ngay khi job bị
// huỷ, thay vì giữ hàng đợi tới timeout của bước đó.
function raceAbort(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(cancelled());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(cancelled());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      value => { signal.removeEventListener('abort', onAbort); resolve(value); },
      error => { signal.removeEventListener('abort', onAbort); reject(error); },
    );
  });
}

function getPrintSession() {
  if (printSession) return printSession;
  const s = session.fromPartition(PARTITION);
  // Chỉ tài nguyên local được phép: mọi kết nối http(s)/ws(s) bị huỷ ngay
  // trong webRequest, trước khi ra khỏi tiến trình. Đếm theo webContents để
  // lần in hiện tại biết mình đã bỏ qua bao nhiêu tài nguyên.
  const block = (details, callback) => {
    const id = details?.webContentsId;
    if (Number.isInteger(id)) blockedByWindow.set(id, (blockedByWindow.get(id) || 0) + 1);
    callback({ cancel: true });
  };
  s.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    block,
  );
  s.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  s.setPermissionCheckHandler(() => false);
  printSession = s;
  return s;
}

function destroyWindow(win) {
  if (!win) return;
  openWindows.delete(win);
  try {
    if (!win.isDestroyed()) {
      blockedByWindow.delete(win.webContents.id);
      win.destroy();
    }
  } catch { /* cửa sổ đã đóng */ }
}

function blockedCount(win) {
  if (!win) return 0;
  try {
    return blockedByWindow.get(win.webContents.id) || 0;
  } catch {
    return 0;
  }
}

function createPrintWindow() {
  const win = new BrowserWindow({
    show: false,
    width: 1024,
    height: 768,
    skipTaskbar: true,
    webPreferences: {
      session: getPrintSession(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  openWindows.add(win);
  try {
    win.on('closed', () => openWindows.delete(win));

    const wc = win.webContents;
    // Không cho trang mở cửa sổ mới hay tự điều hướng đi đâu khác.
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-navigate', e => e.preventDefault());
    wc.on('will-redirect', e => e.preventDefault());
    // Chặn cả iframe: trang in chỉ được là một tài liệu local duy nhất.
    wc.on('will-frame-navigate', e => e.preventDefault());
    wc.on('will-attach-webview', e => e.preventDefault());
    return win;
  } catch (e) {
    // Không để cửa sổ nửa cấu hình rò rỉ nếu thiết lập sự kiện lỗi.
    destroyWindow(win);
    throw e;
  }
}

function loadHtml(win, filePath, signal) {
  return new Promise((resolve, reject) => {
    const wc = win.webContents;
    let settled = false;
    let timer = null;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      wc.removeListener('did-finish-load', onDone);
      wc.removeListener('did-fail-load', onFail);
      wc.removeListener('render-process-gone', onGone);
      if (signal) signal.removeEventListener('abort', onAbort);
      fn(value);
    };
    const onDone = () => finish(resolve, true);
    const onFail = (_e, _code, _desc, _url, isMainFrame) => {
      if (isMainFrame === false) return;
      finish(reject, signal?.aborted ? cancelled() : invalidHtml());
    };
    const onGone = () => finish(reject, signal?.aborted ? cancelled() : printFailed());
    // Huỷ khi đang tải phải kết thúc ngay, không giữ hàng đợi tới load timeout.
    const onAbort = () => finish(reject, cancelled());

    timer = setTimeout(() => finish(reject, printFailed()), LOAD_TIMEOUT_MS);
    wc.on('did-finish-load', onDone);
    wc.on('did-fail-load', onFail);
    wc.on('render-process-gone', onGone);
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) {
        onAbort();
        return;
      }
    }
    wc.loadURL(pathToFileURL(filePath).href).catch(() => {
      finish(reject, signal?.aborted ? cancelled() : invalidHtml());
    });
  });
}

// did-finish-load chưa bảo đảm webfont đã sẵn sàng; chờ document.fonts.ready
// rồi thêm một nhịp ngắn để bố cục không đổi giữa lúc in.
async function settleDocument(win, signal) {
  let timer = null;
  try {
    // Font lỗi/chặn mạng cũng làm ready() resolve; timeout chỉ là chốt chặn
    // để một trang hỏng không giữ cửa sổ in mãi. Khi fonts.ready thắng thì
    // phải xoá timeout, không để nó treo lại sau khi in xong.
    await raceAbort(Promise.race([
      win.webContents.executeJavaScript(
        'document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : true',
        false,
      ),
      new Promise(resolve => { timer = setTimeout(resolve, FONT_TIMEOUT_MS); }),
    ]), signal);
  } catch (e) {
    if (signal?.aborted || e?.code === 'CANCELLED') throw cancelled();
    throw e instanceof ToolError ? e : printFailed();
  } finally {
    clearTimeout(timer);
  }
  if (signal?.aborted) throw cancelled();
  await new Promise(resolve => setTimeout(resolve, SETTLE_MS));
  if (signal?.aborted) throw cancelled();
}

async function renderPdf(win, opts, signal) {
  const inches = opts.marginMm / 25.4;
  let timer = null;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(printFailed()), PRINT_TIMEOUT_MS);
  });
  try {
    const data = await raceAbort(Promise.race([
      win.webContents.printToPDF({
        pageSize: opts.pageSize,
        landscape: opts.landscape,
        printBackground: opts.printBackground,
        scale: 1,
        // Electron tính lề bằng inch.
        margins: { top: inches, bottom: inches, left: inches, right: inches },
        preferCSSPageSize: false,
      }),
      timeout,
    ]), signal);
    if (signal?.aborted) throw cancelled();
    return Buffer.from(data);
  } catch (e) {
    if (signal?.aborted) throw cancelled();
    throw e instanceof ToolError ? e : printFailed();
  } finally {
    clearTimeout(timer);
  }
}

function normalize(options) {
  if (!options || typeof options !== 'object') {
    throw new ToolError('INVALID_OPTIONS', 'Tuỳ chọn in không hợp lệ.');
  }
  const { filePath } = options;
  if (typeof filePath !== 'string' || !filePath) {
    throw new ToolError('INVALID_FILE', 'Chưa chọn file HTML.');
  }
  const pageSize = options.pageSize ?? 'A4';
  if (!PAGE_SIZES.has(pageSize)) {
    throw new ToolError('INVALID_OPTIONS', 'Khổ giấy không hợp lệ.');
  }
  const landscape = options.landscape ?? false;
  const printBackground = options.printBackground ?? true;
  if (typeof landscape !== 'boolean' || typeof printBackground !== 'boolean') {
    throw new ToolError('INVALID_OPTIONS', 'Tuỳ chọn in không hợp lệ.');
  }
  const marginMm = options.marginMm ?? 10;
  if (typeof marginMm !== 'number' || !Number.isFinite(marginMm) || marginMm < 0 || marginMm > 50) {
    throw new ToolError('INVALID_OPTIONS', 'Lề không hợp lệ.');
  }
  return { filePath, pageSize, landscape, printBackground, marginMm };
}

/**
 * In một file HTML local thành PDF bằng cửa sổ ẩn. Các lần in được xếp hàng
 * tuần tự vì mỗi lần dùng một cửa sổ Chromium riêng.
 *
 * Trả về `{ buffer, blocked }`; `blocked` là số request http/https/ws/wss đã bị
 * chặn trong lần in này. Giới hạn đã biết: WebRTC/STUN, DNS prefetch và
 * preconnect không đi qua webRequest nên không bị chặn/đếm; iframe (kể cả
 * local) bị từ chối vì `will-frame-navigate` chỉ cho tài liệu chính tải.
 * @returns {Promise<{ buffer: Buffer, blocked: number }>}
 */
function printHtml(options = {}) {
  let opts;
  try {
    opts = normalize(options);
  } catch (e) {
    return Promise.reject(e);
  }
  const { signal } = options;
  if (signal?.aborted) return Promise.reject(cancelled());

  return new Promise((resolve, reject) => {
    let settled = false;
    let win = null;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve(value);
    };
    // Huỷ phải có hiệu lực ngay, kể cả khi task còn nằm trong hàng đợi.
    const onAbort = () => {
      finish(cancelled());
      destroyWindow(win);
    };
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) return onAbort();
    }

    const task = async () => {
      if (settled) return;
      let current = null;
      try {
        // Tạo cửa sổ/session cũng có thể ném lỗi; phải nằm trong try để
        // promise kết thúc và hàng đợi in không bị treo.
        current = createPrintWindow();
        win = current;
        await loadHtml(current, opts.filePath, signal);
        if (settled) return;
        await settleDocument(current, signal);
        if (settled) return;
        const data = await renderPdf(current, opts, signal);
        if (settled) return;
        finish(null, { buffer: data, blocked: blockedCount(current) });
      } catch (e) {
        finish(signal?.aborted ? cancelled() : (e instanceof ToolError ? e : printFailed()));
      } finally {
        destroyWindow(current);
        if (win === current) win = null;
      }
    };
    const p = chain.then(task, task);
    chain = p.catch(() => { /* giữ chuỗi in tuần tự kể cả khi một lần in lỗi */ });
  });
}

/** Đóng mọi cửa sổ in còn sống (gọi khi thoát ứng dụng). */
function destroyHtmlPrinter() {
  for (const win of [...openWindows]) destroyWindow(win);
  openWindows.clear();
}

module.exports = { printHtml, destroyHtmlPrinter, PARTITION };
