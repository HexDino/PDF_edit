# M1b — PDF → ảnh và Khoá PDF: Kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm hai công cụ còn lại của M1 — xuất PDF thành ảnh và đặt mật khẩu PDF — vào shell/engine đã có, giữ nguyên editor và 8 bộ test cũ.

**Architecture:** Dùng lại JobRunner, registry, shell và preload của M1a. PDF → ảnh dùng một BrowserWindow ẩn (`render-worker`) nạp pdf.js sẵn có; file nguồn được phục vụ qua scheme `pdfsrc` theo token. Khoá PDF chạy qpdf với mật khẩu truyền qua file tham số tạm, không lên dòng lệnh. Cả hai công cụ chạy qua job queue và tự publish không ghi đè.

**Tech Stack:** Electron 33, pdf.js vendored, qpdf 12.4.2 (Apache-2.0), pdf-lib 1.17.1, Playwright core, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-28-ilovepdf-suite-design.md`

## Global Constraints

- Windows x64; offline; no AGPL; qpdf 12.4.2 + SHA pinned.
- Engine CommonJS `.js`; main/preload CommonJS; tests ESM `.mjs` using `createRequire`.
- Keep all existing editor features/selectors/tests; do not modify editor files.
- Exactly one JobRunner in main; max 2 concurrent; render worker serializes render tasks.
- No overwrite: use `publishUnique` for final files and unique output directories.
- Passwords never on the command line or in logs; qpdf receives them via a temporary argument file.
- Job IPC returns envelopes and is sender/path-allowlisted; new channels must obey the same rules.
- PDF→images output: one file per selected page, `‹base›-anh/‹base›-01.jpg`; protect output: `‹base›-khoa.pdf`.

---

## File Structure

**Create**
- `app/suite/render-worker.js` — hidden BrowserWindow + pdfsrc protocol + render queue.
- `app/suite/worker-preload.js` — minimal worker IPC bridge.
- `app/renderer/worker/render.html`, `app/renderer/worker/render.js` — pdf.js page renderer.
- `app/suite/pdfops/convert.js` — PDF→images tool.
- `app/suite/pdfops/security.js` — protect tool.
- `app/test/suite-unit/convert.test.mjs`, `app/test/suite-unit/protect.test.mjs`.

**Modify**
- `app/main.js` — register `pdfsrc`, create render service, pass to JobRunner, quit cleanup.
- `app/suite/jobs.js` — accept/inject `render` service into `ctx`.
- `app/suite/util/paths.js` — add `uniqueDir`.
- `app/suite/registry.js` — make `pdf-images`/`protect` available with options/runs.
- `app/renderer/suite.js` — add test hook `setOptions`; home/status behavior already generic.
- `app/test/suite-e2e.mjs` — update available/disabled counts and add both tool flows.
- `app/test/suite-unit/registry.test.mjs` — assert new available tools if needed.

**Do not modify**
- `app/renderer/app.js`, `app/renderer/editor.html`, editor tests, 8 old suites.

---

## Task 1: Render worker + PDF → ảnh

**Files:**
- Create: `app/suite/render-worker.js`, `app/suite/worker-preload.js`, `app/renderer/worker/render.html`, `app/renderer/worker/render.js`, `app/suite/pdfops/convert.js`, `app/test/suite-unit/convert.test.mjs`
- Modify: `app/suite/util/paths.js`, `app/suite/jobs.js`, `app/main.js`, `app/suite/registry.js`, `app/renderer/suite.js`, `app/test/suite-e2e.mjs`, `app/test/suite-unit/paths.test.mjs`

**Interfaces:**
- `ctx.render.pdfToImages({ filePath, pages, dpi, format, quality, outDir, signal, progress }) -> Promise<[{ page, path }]>` (temp files written by main).
- `uniqueDir(dir, name) -> string` (unique directory path).
- `pdfImages(ctx)` returns `{ outputs, errors, stats }`; options: `pages` range, `dpi` int 72–600, `format` 'jpg'|'png', `quality` int 60–100.
- Registry `pdf-images` becomes `available` with those options and `run: pdfImages`.

- [ ] **Step 1: Write failing unit tests for uniqueDir + convert**

Add to `app/test/suite-unit/paths.test.mjs`:

```js
test('uniqueDir lùi tên khi đã tồn tại', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsp-dir-'));
  fs.mkdirSync(path.join(dir, 'a-anh'));
  assert.equal(path.basename(uniqueDir(dir, 'a-anh')), 'a-anh (2)');
  fs.rmSync(dir, { recursive: true, force: true });
});
```

Create `app/test/suite-unit/convert.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PDFDocument } = require('pdf-lib');
const { pdfImages } = require('../../suite/pdfops/convert.js');

async function makePdf(file, n) {
  const d = await PDFDocument.create();
  for (let i = 0; i < n; i++) d.addPage([200 + i, 300]);
  fs.writeFileSync(file, await d.save());
}

function ctxFor(file, dir, render) {
  const tempDir = fs.mkdtempSync(path.join(dir, 'tmp-'));
  return {
    files: [file], tempDir, outputDir: dir, signal: new AbortController().signal,
    options: { pages: '', dpi: 72, format: 'png', quality: 90 },
    progress() {}, log() {}, render,
  };
}

test('xuất đúng số trang, đặt tên và thư mục -anh', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsp-img-'));
  const file = path.join(dir, 'a.pdf');
  await makePdf(file, 3);
  const render = async ({ pages, outDir }) => pages.map(n => {
    const p = path.join(outDir, `p-${n}.png`);
    fs.writeFileSync(p, 'png');
    return { page: n, path: p };
  });
  const r = await pdfImages(ctxFor(file, dir, render));
  assert.equal(r.outputs.length, 3);
  assert.equal(path.basename(path.dirname(r.outputs[0].path)), 'a-anh');
  assert.match(path.basename(r.outputs[0].path), /^a-01\.png$/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('tôn trọng khoảng trang và định dạng jpg', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsp-img-'));
  const file = path.join(dir, 'b.pdf');
  await makePdf(file, 4);
  const render = async ({ pages, outDir, format }) => pages.map(n => {
    const p = path.join(outDir, `p-${n}.${format}`);
    fs.writeFileSync(p, 'x');
    return { page: n, path: p };
  });
  const ctx = ctxFor(file, dir, render);
  ctx.options = { ...ctx.options, pages: '2-3', format: 'jpg' };
  const r = await pdfImages(ctx);
  assert.deepEqual(r.outputs.map(o => path.basename(o.path)), ['b-02.jpg', 'b-03.jpg']);
  fs.rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run tests — expect fail**

Run: `cd app && npm run test:tools`
Expected: FAIL `Cannot find module .../suite/pdfops/convert.js`; paths test fails on `uniqueDir`.

- [ ] **Step 3: Implement uniqueDir + convert**

Add to `app/suite/util/paths.js`:

```js
function uniqueDir(dir, name, exists = fs.existsSync) {
  let candidate = path.join(dir, name);
  if (!exists(candidate)) return candidate;
  for (let i = 2; i < 10000; i++) {
    candidate = path.join(dir, `${name} (${i})`);
    if (!exists(candidate)) return candidate;
  }
  throw new Error('Không tìm được tên thư mục trống');
}
```

Export it in `module.exports`.

Create `app/suite/pdfops/convert.js`:

```js
const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument } = require('pdf-lib');
const { ToolError } = require('../errors');
const { parsePageRange } = require('../pages');
const { splitExt, uniqueDir } = require('../util/paths');

async function pdfImages(ctx) {
  const file = ctx.files[0];
  let doc;
  try { doc = await PDFDocument.load(fs.readFileSync(file)); }
  catch (e) {
    if (/encrypt/i.test(e.message)) throw new ToolError('PASSWORD_REQUIRED', 'PDF có mật khẩu. Hãy mở khoá trước.');
    throw new ToolError('INVALID_FILE', 'Không đọc được PDF.');
  }
  const pageCount = doc.getPageCount();
  const pages = parsePageRange(ctx.options.pages, pageCount);
  const format = ctx.options.format === 'png' ? 'png' : 'jpg';
  const root = ctx.outputDir || path.dirname(file);
  const base = splitExt(file).base;
  const folder = uniqueDir(root, `${base}-anh`);
  fs.mkdirSync(folder, { recursive: true });

  const rendered = await ctx.render.pdfToImages({
    filePath: file, pages, dpi: ctx.options.dpi, format,
    quality: ctx.options.quality / 100, outDir: ctx.tempDir,
    signal: ctx.signal,
    progress: (done, total) => ctx.progress('processing', done, total, `Đang xuất trang ${done}/${total}…`),
  });
  ctx.signal.throwIfAborted();

  const outputs = [];
  for (const item of rendered) {
    const dest = path.join(folder, `${base}-${String(item.page).padStart(2, '0')}.${format}`);
    fs.copyFileSync(item.path, dest);
    outputs.push({ path: dest });
  }
  return { outputs, errors: [], stats: { pages: outputs.length } };
}

module.exports = { pdfImages };
```

- [ ] **Step 4: Implement render worker**

Create `app/suite/worker-preload.js`:

```js
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('workerApi', {
  onTask: cb => ipcRenderer.on('render:task', (_e, task) => cb(task)),
  page: (taskId, page, bytes, meta) => ipcRenderer.send('render:page', { taskId, page, bytes, meta }),
  progress: (taskId, current, total) => ipcRenderer.send('render:progress', { taskId, current, total }),
  done: (taskId, error) => ipcRenderer.send('render:done', { taskId, error }),
});
```

Create `app/renderer/worker/render.html`:

```html
<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'self' data:; script-src 'self'; worker-src 'self' blob:; connect-src 'self' pdfsrc:; img-src 'self' data: blob:">
<title>Render worker</title>
</head>
<body>
<script type="module" src="render.js"></script>
</body>
</html>
```

Create `app/renderer/worker/render.js`:

```js
import * as pdfjsLib from '../vendor/pdf.min.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;

window.workerApi.onTask(async task => {
  try {
    const doc = await pdfjsLib.getDocument({
      url: task.url, isEvalSupported: false,
      cMapUrl: new URL('../vendor/cmaps/', import.meta.url).href, cMapPacked: true,
      standardFontDataUrl: new URL('../vendor/standard_fonts/', import.meta.url).href,
    }).promise;
    for (const n of task.pages) {
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: task.dpi / 72 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      const blob = await new Promise(res => canvas.toBlob(res, task.format === 'png' ? 'image/png' : 'image/jpeg', task.quality));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      window.workerApi.page(task.id, n, bytes, { width: canvas.width, height: canvas.height });
      window.workerApi.progress(task.id, task.pages.indexOf(n) + 1, task.pages.length);
    }
    window.workerApi.done(task.id, null);
  } catch (e) {
    window.workerApi.done(task.id, String(e?.message || e));
  }
});
```

Create `app/suite/render-worker.js`:

```js
const { BrowserWindow, ipcMain, protocol } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Readable } = require('node:stream');
const { ToolError } = require('./errors');

const sources = new Map();
const tasks = new Map();
let worker = null;
let ready = null;
let chain = Promise.resolve();

function registerRenderProtocol() {
  protocol.handle('pdfsrc', req => {
    const token = new URL(req.url).hostname;
    const file = sources.get(token);
    if (!file || !fs.existsSync(file)) return new Response('forbidden', { status: 403 });
    return new Response(Readable.toWeb(fs.createReadStream(file)), {
      headers: { 'content-type': 'application/pdf' },
    });
  });
}

function ensureWorker() {
  if (worker && !worker.isDestroyed()) return ready;
  worker = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'worker-preload.js'),
      contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
    },
  });
  worker.on('closed', () => { worker = null; ready = null; });
  ready = worker.loadURL('app://local/worker/render.html');
  return ready;
}

function resetWorker() {
  try { worker?.destroy(); } catch {}
  worker = null; ready = null;
}

ipcMain.on('render:page', (event, msg) => {
  if (!worker || event.sender !== worker.webContents) return;
  const t = tasks.get(msg.taskId); if (!t) return;
  const file = path.join(t.outDir, `render-${msg.page}.${t.format}`);
  fs.writeFileSync(file, Buffer.from(msg.bytes));
  t.files.push({ page: msg.page, path: file });
});
ipcMain.on('render:progress', (event, msg) => {
  if (!worker || event.sender !== worker.webContents) return;
  tasks.get(msg.taskId)?.progress?.(msg.current, msg.total);
});
ipcMain.on('render:done', (event, msg) => {
  if (!worker || event.sender !== worker.webContents) return;
  const t = tasks.get(msg.taskId); if (!t) return;
  tasks.delete(msg.taskId);
  sources.delete(t.token);
  if (msg.error) t.reject(new ToolError('RENDER_FAILED', 'Không render được trang PDF.'));
  else t.resolve(t.files);
});

function pdfToImages(opts) {
  const run = () => new Promise((resolve, reject) => {
    const token = randomUUID();
    sources.set(token, opts.filePath);
    const id = randomUUID();
    tasks.set(id, { ...opts, token, files: [], resolve, reject });
    const onAbort = () => {
      tasks.delete(id); sources.delete(token); resetWorker();
      reject(Object.assign(new Error('Đã huỷ'), { code: 'CANCELLED' }));
    };
    if (opts.signal) {
      if (opts.signal.aborted) return onAbort();
      opts.signal.addEventListener('abort', onAbort, { once: true });
    }
    ensureWorker().then(() => {
      worker.webContents.send('render:task', {
        id, url: `pdfsrc://${token}/doc.pdf`, pages: opts.pages,
        dpi: opts.dpi, format: opts.format, quality: opts.quality,
      });
    }).catch(e => { tasks.delete(id); sources.delete(token); reject(e); });
  });
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}

function destroyRenderWorker() { resetWorker(); }
module.exports = { registerRenderProtocol, pdfToImages, destroyRenderWorker };
```

- [ ] **Step 5: Wire render service and IPC scheme**

In `app/suite/jobs.js`, add `render` constructor option and `ctx.render = this.render`. In `app/main.js`:
- Add `{ scheme: 'pdfsrc', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }` to `registerSchemesAsPrivileged`.
- `const { registerRenderProtocol, pdfToImages, destroyRenderWorker } = require('./suite/render-worker');`
- In `whenReady` after the app protocol handler, call `registerRenderProtocol();`.
- Pass `render: { pdfToImages }` to the single `JobRunner`.
- Add `app.on('before-quit', () => destroyRenderWorker());`.
- Ensure `registerRenderProtocol` is called before `createWindow()`, and the worker page can load via `app://`.
- `suite:register-input` allowlist already covers inputs; output dir selected via `pick-output`.

- [ ] **Step 6: Registry + shell test hook**

In `app/suite/registry.js`:
```js
const { pdfImages } = require('./pdfops/convert');
// replace pdf-images entry:
{ id: 'pdf-images', group: 'convert', title: 'PDF → ảnh', description: 'Xuất từng trang thành JPG hoặc PNG.', icon: '🖼', accept: ['.pdf'], multiple: false, status: 'available', options: [
  { key: 'pages', type: 'range', label: 'Khoảng trang', placeholder: '1-3,5,8- (trống = tất cả)' },
  { key: 'dpi', type: 'int', min: 72, max: 600, default: 150, label: 'DPI' },
  { key: 'format', type: 'enum', values: ['jpg', 'png'], labels: { jpg: 'JPG — nhẹ hơn', png: 'PNG — nét hơn' }, default: 'jpg', label: 'Định dạng' },
  { key: 'quality', type: 'int', min: 60, max: 100, default: 90, label: 'Chất lượng JPEG (%)' },
], run: pdfImages },
```
Add `setOptions` to `window.__suite` in `app/renderer/suite.js`:
```js
setOptions: partial => { Object.assign(state.options, partial); renderOptions(); },
```

- [ ] **Step 7: E2E for pdf-images + counts**

Update existing home counts in `app/test/suite-e2e.mjs` from 1 enabled/13 disabled/13 badges to **2 enabled/12 disabled/12 badges**. After merge block, add:
- create `m1b-2pages.pdf` with pdf-lib (2 pages)
- `await w.evaluate(({file,out}) => window.api.suite.registerInput([file,out]), {...})`
- open `pdf-images`, add file, set output dir, setOptions `{pages:'',dpi:72,format:'png',quality:90}`
- run, wait, assert 2 outputs, both exist, PNG magic (`89 50 4E 47`), folder name ends `-anh`.

- [ ] **Step 8: Run tests**

`npm run test:tools` (expect 61+3), `npm run test:suite`, `npm test`.

- [ ] **Step 9: Commit**

`git commit -m "M1b: render worker và công cụ PDF → ảnh"`.

---

## Task 2: Khoá PDF

**Files:**
- Create: `app/suite/pdfops/security.js`, `app/test/suite-unit/protect.test.mjs`
- Modify: `app/suite/registry.js`, `app/test/suite-e2e.mjs`

**Interfaces:**
- `protect(ctx)` options: `openPassword` (required), `ownerPassword` (optional), `allowPrint`, `allowCopy`, `allowModify` booleans. Output `‹base›-khoa.pdf` via `publishUnique`. qpdf receives passwords via a temp arg file; never command line/log.
- Registry `protect` available with those options and `run: protect`.

- [ ] **Step 1: Unit test with real qpdf**

`app/test/suite-unit/protect.test.mjs`:
- helper `makePdf` using pdf-lib.
- helper `qpdf(args)` using `runProcess(binaryPath(...))`.
- `protect(ctx)` with open `'secret'`, owner `'owner'`, output dir; assert output exists, not overwritten (`base-khoa.pdf`, then `(2)`).
- `qpdf(['--show-encryption','--password=secret', out])` stdout contains `AESv3`/`R = 6`; wrong password rejects.
- encrypted input test: create encrypted fixture via qpdf, then `protect` should throw `PASSWORD_REQUIRED` (or at least not overwrite). If qpdf input is encrypted, protect cannot open; map.
- temp arg file not left in `ctx.tempDir`.

- [ ] **Step 2: Implement security.js**

```js
const fs = require('node:fs');
const path = require('node:path');
const { ToolError } = require('../errors');
const { outputName, publishUnique } = require('../util/paths');

async function protect(ctx) {
  const file = ctx.files[0];
  const open = ctx.options.openPassword || '';
  const owner = ctx.options.ownerPassword || open;
  if (!open) throw new ToolError('INVALID_OPTIONS', 'Hãy nhập mật khẩu mở.');
  if (/[\r\n]/.test(open) || /[\r\n]/.test(owner)) throw new ToolError('INVALID_OPTIONS', 'Mật khẩu không hợp lệ.');
  const tmp = path.join(ctx.tempDir, 'protected.pdf');
  const argFile = path.join(ctx.tempDir, 'qpdf-args.txt');
  const modify = !!ctx.options.allowModify;
  const lines = [
    '--encrypt', open, owner, '256',
    `--print=${ctx.options.allowPrint ? 'full' : 'none'}`,
    `--modify=${modify ? 'all' : 'none'}`,
    `--extract=${ctx.options.allowCopy ? 'y' : 'n'}`,
    `--annotate=${modify ? 'y' : 'n'}`,
    `--form=${modify ? 'y' : 'n'}`,
    `--accessibility=${modify ? 'y' : 'n'}`,
    `--assemble=${modify ? 'y' : 'n'}`,
    `--modify-other=${modify ? 'y' : 'n'}`,
    '--', file, tmp,
  ];
  fs.writeFileSync(argFile, lines.join('\n') + '\n');
  try {
    await ctx.qpdf(['@' + argFile]);
  } catch (e) {
    if (/password|encrypt/i.test(`${e.stderr || ''} ${e.message || ''}`)) {
      throw new ToolError('PASSWORD_REQUIRED', 'PDF đã được mã hoá; cần mở khoá trước khi đặt mật khẩu mới.');
    }
    throw new ToolError('INTERNAL', 'Không khoá được PDF.');
  } finally {
    try { fs.rmSync(argFile, { force: true }); } catch {}
  }
  if (!fs.existsSync(tmp)) throw new ToolError('INTERNAL', 'qpdf không tạo được file.');
  const outDir = ctx.outputDir || path.dirname(file);
  const out = publishUnique(tmp, outDir, outputName(file, 'khoa'));
  return { outputs: [{ path: out }], errors: [], stats: {} };
}

module.exports = { protect };
```

- [ ] **Step 3: Registry options**

```js
{ key: 'openPassword', type: 'password', label: 'Mật khẩu mở', required: true },
{ key: 'ownerPassword', type: 'password', label: 'Mật khẩu chủ (trống = trùng mật khẩu mở)' },
{ key: 'allowPrint', type: 'bool', default: true, label: 'Cho phép in' },
{ key: 'allowCopy', type: 'bool', default: false, label: 'Cho phép sao chép' },
{ key: 'allowModify', type: 'bool', default: false, label: 'Cho phép sửa' },
```
Make `protect` available with `run: protect`.

- [ ] **Step 4: E2E protect + counts**

Update home counts to **3 enabled/11 disabled/11 badges**. After pdf-images flow, add protect:
- use `m1b-2pages.pdf`; register input/outDir;
- open `protect`, add file, setOptions `{openPassword:'secret',ownerPassword:'owner',allowPrint:true,allowCopy:false,allowModify:false}`;
- run, assert output path ends `-khoa.pdf`, exists;
- `qpdf --show-encryption --password=secret out` stdout contains `AESv3`/`R = 6`; wrong password fails.
Keep all existing assertions.

- [ ] **Step 5: Tests**

`npm run test:tools`, `npm run test:suite`, `npm test`; all 8 old suites; `npm run build`; packaged qpdf still works.

- [ ] **Step 6: Commit**

`git commit -m "M1b: công cụ khoá PDF bằng qpdf"`.

---

## Verification / Acceptance

- 2 tools available; 12 planned; shell shows correct counts.
- PDF→images: 2-page fixture → 2 PNG files, correct names/folder, cancel cleans temp.
- Protect: output encrypted AES-256, correct password opens, wrong fails, no overwrite, passwords not in process args/log.
- Existing editor and 8 suites unchanged; full unit/E2E/build green.
- No new AGPL dependency; packaging includes worker assets and qpdf.
