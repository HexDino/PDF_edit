# M1a — Nền tảng bộ công cụ + ghép PDF: Kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dựng shell home/tool, engine job ở main process, đóng gói qpdf và công cụ Ghép PDF chạy end-to-end, trong khi toàn bộ editor hiện tại vẫn hoạt động và 8 bộ test cũ vẫn xanh.

**Architecture:** Thêm một shell renderer mới (`index.html` + `suite.js`) và chuyển editor sang `editor.html`; main process sở hữu registry, job queue và qpdf. Dữ liệu công cụ truyền qua IPC bằng đường dẫn file. Editor không đổi logic, chỉ thêm nút về Trang chủ; chế độ test cũ vẫn mở editor làm entry.

**Tech Stack:** Electron 33, Node 20 (trong Electron), pdf-lib 1.17.1, qpdf 12.4.2 (mingw64 x64), Playwright core, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-28-ilovepdf-suite-design.md`

## Global Constraints

- Windows x64; offline hoàn toàn; UI tiếng Việt.
- Không dùng thư viện AGPL. qpdf là Apache-2.0; pdf-lib MIT.
- Giữ nguyên toàn bộ chức năng editor hiện có; không đổi selector/test cũ.
- Không ghi đè file gốc mặc định; đầu ra đặt cạnh file nguồn với hậu tố.
- Mọi job chạy trong main process; không chặn UI; huỷ dừng ≤2 giây.
- Không đưa mật khẩu vào dòng lệnh hay log.
- qpdf cố định phiên bản **12.4.2**, SHA-256 `773D2FA0C7D161E2271430734338E560A07B25D0EDF11CEEE8E53DE435012766`.
- Module engine `app/suite/` là CommonJS (`.js`) để `require` ổn định trong asar; `main.js` nạp bằng `require`, test `.mjs` dùng `createRequire`. Không dùng ESM trong engine.
- Kế hoạch này chỉ gồm **M1a**. M1b (render worker + PDF → ảnh + khoá PDF + file gần đây/Cài đặt nhẹ), M2 (11 công cụ) và M3 (redesign editor + đóng gói) có kế hoạch riêng sau khi M1a xong.

---

## File Structure

**Tạo mới**
- `app/scripts/fetch-qpdf.mjs` — tải, kiểm SHA, giải nén qpdf.
- `app/suite/errors.js` — `ToolError` và payload lỗi.
- `app/suite/pages.js` — parser khoảng trang.
- `app/suite/schema.js` — validate tuỳ chọn công cụ.
- `app/suite/registry.js` — manifest 14 công cụ (M1a chỉ `merge` khả dụng).
- `app/suite/jobs.js` — queue, tiến độ, huỷ, temp.
- `app/suite/pdfops/organize.js` — `merge`.
- `app/suite/util/paths.js` — đường dẫn binary, đặt tên, move.
- `app/suite/util/spawn.js` — spawn không shell, kill cây tiến trình.
- `app/suite/util/log.js` — log xoay vòng.
- `app/renderer/ui/tokens.css` — token dùng chung.
- `app/renderer/suite.css` — style shell.
- `app/renderer/suite.js` — home/tool SPA + test hook.
- `app/renderer/editor.html` — editor hiện tại (đổi tên từ `index.html`).
- `app/renderer/index.html` — shell mới.
- `app/test/suite-unit/*.test.mjs` — unit test Node.
- `app/test/suite-e2e.mjs` — E2E shell + merge + editor navigation.
- `app/THIRD-PARTY-NOTICES.txt` — giấy phép qpdf.

**Sửa**
- `app/package.json` — dependency pdf-lib, scripts, extraResources, files.
- `app/main.js` — entry home/editor, IPC suite, runner.
- `app/preload.js` — API suite.
- `app/renderer/app.js` — nút `#homeBtn`.
- `.gitignore` — bỏ qua `app/bin/`.

**Không đổi**
- Toàn bộ test cũ, markup/selector editor, logic render/xuất/chữ ký/phiên.

---

## Task 1: qpdf, dependency và baseline

**Files:**
- Modify: `app/package.json`, `.gitignore`
- Create: `app/scripts/fetch-qpdf.mjs`, `app/test/suite-unit/qpdf.test.mjs`

**Interfaces:**
- Produces: `app/bin/win32-x64/qpdf.exe` chạy được; npm scripts `fetch:qpdf`, `test:tools`; dependency `pdf-lib`.

- [ ] **Step 1: Viết test kiểm tra binary**

Tạo `app/test/suite-unit/qpdf.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('qpdf 12.4.2 chạy được', () => {
  const out = execFileSync(process.execPath, ['scripts/fetch-qpdf.mjs', '--check'], {
    cwd: APP_ROOT, encoding: 'utf8',
  });
  assert.match(out, /qpdf version 12\.4\.2/);
});
```

- [ ] **Step 2: Chạy test để thấy fail**

Run: `cd app && node --test test/suite-unit`
Expected: FAIL vì chưa có `scripts/fetch-qpdf.mjs` / binary.

- [ ] **Step 3: Viết script tải và kiểm SHA**

Tạo `app/scripts/fetch-qpdf.mjs`:

```js
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = '12.4.2';
const ZIP_URL = `https://github.com/qpdf/qpdf/releases/download/v${VERSION}/qpdf-${VERSION}-mingw64.zip`;
const SHA256 = '773D2FA0C7D161E2271430734338E560A07B25D0EDF11CEEE8E53DE435012766';
const DEST = path.join(APP_ROOT, 'bin', 'win32-x64');
const EXE = path.join(DEST, 'qpdf.exe');

function check() {
  if (!fs.existsSync(EXE)) {
    console.error('Thiếu qpdf.exe — chạy: npm run fetch:qpdf');
    process.exit(1);
  }
  const out = execFileSync(EXE, ['--version'], { encoding: 'utf8' });
  console.log(out.trim());
  if (!out.includes(`qpdf version ${VERSION}`)) {
    console.error(`Sai phiên bản qpdf, cần ${VERSION}`);
    process.exit(1);
  }
}

async function main() {
  if (process.argv.includes('--check')) return check();
  await download();
  check();
}

function findFile(dir, name) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(full, name);
      if (found) return found;
    } else if (entry.name.toLowerCase() === name.toLowerCase()) {
      return full;
    }
  }
  return null;
}

async function download() {
  if (fs.existsSync(EXE)) return;
  fs.mkdirSync(DEST, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(APP_ROOT, 'bin', 'qpdf-'));
  const zip = path.join(tmp, 'qpdf.zip');
  const res = await fetch(ZIP_URL, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Tải qpdf thất bại: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const hash = crypto.createHash('sha256').update(buf).digest('hex').toUpperCase();
  if (hash !== SHA256) throw new Error(`SHA-256 không khớp: ${hash}`);
  fs.writeFileSync(zip, buf);

  const extract = path.join(tmp, 'extract');
  execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    'Expand-Archive -LiteralPath $env:QPDF_ZIP -DestinationPath $env:QPDF_EXTRACT -Force',
  ], { env: { ...process.env, QPDF_ZIP: zip, QPDF_EXTRACT: extract }, stdio: 'inherit' });

  const exePath = findFile(extract, 'qpdf.exe');
  if (!exePath) throw new Error('Không tìm thấy qpdf.exe trong gói tải về');
  const srcDir = path.dirname(exePath);
  fs.mkdirSync(DEST, { recursive: true });
  for (const entry of fs.readdirSync(srcDir)) {
    fs.cpSync(path.join(srcDir, entry), path.join(DEST, entry), { recursive: true, force: true });
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

main().catch(e => { console.error(e.message); process.exit(1); });
```

- [ ] **Step 4: Thêm scripts, dependency, gitignore**

Sửa `app/package.json`:

```json
"scripts": {
  "start": "electron .",
  "fetch:qpdf": "node scripts/fetch-qpdf.mjs",
  "test:tools": "node --test \"test/suite-unit/*.test.mjs\"",
  "test:suite": "node test/suite-e2e.mjs"
}
```

Giữ các script cũ. Chạy:

```bash
cd app
npm install pdf-lib@1.17.1 --save
npm run fetch:qpdf
```

Thêm vào `.gitignore` ở gốc repo:

```gitignore
app/bin/
```

- [ ] **Step 5: Chạy lại test**

Run: `cd app && npm run test:tools`
Expected: PASS (1 test).

- [ ] **Step 6: Baseline test cũ**

Run lần lượt, ghi lại kết quả trước khi sửa code:

```bash
cd app
npm test
npm run test:e2e
npm run test:overlay
npm run test:signature
npm run test:erase
npm run test:editing
npm run test:session
npm run test:rotation
```

Expected: tất cả PASS. Nếu bộ nào fail sẵn, ghi lại để so sánh sau.

- [ ] **Step 7: Commit**

```bash
git add app/package.json app/package-lock.json app/scripts/fetch-qpdf.mjs app/test/suite-unit/qpdf.test.mjs .gitignore
git commit -m "M1a: tải qpdf 12.4.2 và thêm pdf-lib cho main process"
```

---

## Task 2: Tiện ích dùng chung (paths, pages, schema, errors)

**Files:**
- Create: `app/suite/errors.js`, `app/suite/pages.js`, `app/suite/schema.js`, `app/suite/util/paths.js`
- Test: `app/test/suite-unit/pages.test.mjs`, `app/test/suite-unit/schema.test.mjs`, `app/test/suite-unit/paths.test.mjs`

**Interfaces:**
- Produces:
  - `parsePageRange(spec, pageCount) -> number[]` (1-based)
  - `validateOptions(tool, input) -> object`
  - `binaryPath(name, {appRoot, isPackaged, resourcesPath}) -> string`
  - `outputName(input, suffix) -> string`, `uniquePath(dir, name) -> string`, `moveAtomic(src, dst)`
  - `ToolError(code, message)`, `toPayload(error)`

- [ ] **Step 1: Viết test khoảng trang**

Tạo `app/test/suite-unit/pages.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parsePageRange } = require('../../suite/pages.js');

test('khoảng trống = tất cả trang', () => {
  assert.deepEqual(parsePageRange('', 3), [1, 2, 3]);
});
test('1-3,5,8- trên 8 trang', () => {
  assert.deepEqual(parsePageRange('1-3,5,8-', 8), [1, 2, 3, 5, 8]);
});
test('cho phép lặp trang khi trích', () => {
  assert.deepEqual(parsePageRange('2,2,1', 3), [2, 2, 1]);
});
test('vượt số trang báo INVALID_RANGE', () => {
  assert.throws(() => parsePageRange('4', 3), e => e.code === 'INVALID_RANGE');
});
test('khoảng ngược báo lỗi', () => {
  assert.throws(() => parsePageRange('3-1', 5), e => e.code === 'INVALID_RANGE');
});
```

- [ ] **Step 2: Chạy test để thấy fail**

Run: `cd app && npm run test:tools`
Expected: FAIL vì `suite/pages.js` chưa tồn tại.

- [ ] **Step 3: Cài đặt pages/errors**

Tạo `app/suite/errors.js`:

```js
class ToolError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
  }
}

function toPayload(error) {
  if (error instanceof ToolError) return { code: error.code, message: error.message };
  if (error?.code && typeof error.message === 'string') return { code: error.code, message: error.message };
  return { code: 'INTERNAL', message: 'Không xử lý được. Thử lại.' };
}

module.exports = { ToolError, toPayload };
```

Tạo `app/suite/pages.js`:

```js
const { ToolError } = require('./errors');

function parsePageRange(spec, pageCount) {
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new ToolError('INVALID_RANGE', 'PDF không có trang nào.');
  }
  const raw = String(spec ?? '').trim();
  if (!raw) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const out = [];
  for (const part of raw.split(',')) {
    const token = part.trim();
    const m = /^(\d+)(?:-(\d*))?$/.exec(token);
    if (!m) throw invalid(spec);
    const a = Number(m[1]);
    const b = m[2] === undefined ? a : m[2] === '' ? pageCount : Number(m[2]);
    if (a < 1 || b < a || b > pageCount) throw invalid(spec);
    for (let i = a; i <= b; i++) out.push(i);
  }
  return out;
}

function invalid(spec) {
  return new ToolError('INVALID_RANGE', `Khoảng trang không hợp lệ: ${spec}`);
}

module.exports = { parsePageRange };
```

- [ ] **Step 4: Viết test schema và paths**

Tạo `app/test/suite-unit/schema.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { validateOptions } = require('../../suite/schema.js');

const tool = {
  options: [
    { key: 'dpi', type: 'int', min: 72, max: 600, default: 150 },
    { key: 'format', type: 'enum', values: ['jpg', 'png'], default: 'jpg' },
    { key: 'allow', type: 'bool', default: false },
    { key: 'password', type: 'password', default: '' },
  ],
};

test('áp default và ép kiểu hợp lệ', () => {
  assert.deepEqual(validateOptions(tool, { dpi: '300', allow: 1 }), {
    dpi: 300, format: 'jpg', allow: true, password: '',
  });
});
test('từ chối enum lạ', () => {
  assert.throws(() => validateOptions(tool, { format: 'webp' }), e => e.code === 'INVALID_OPTIONS');
});
test('từ chối tuỳ chọn lạ', () => {
  assert.throws(() => validateOptions(tool, { hack: 1 }), e => e.code === 'INVALID_OPTIONS');
});
test('từ chối số ngoài khoảng', () => {
  assert.throws(() => validateOptions(tool, { dpi: 601 }), e => e.code === 'INVALID_OPTIONS');
});
```

Tạo `app/test/suite-unit/paths.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { binaryPath, outputName, uniquePath, moveAtomic } = require('../../suite/util/paths.js');

test('đặt tên đầu ra', () => {
  assert.equal(outputName('D:/a/ho-so.pdf', 'ghep'), 'ho-so-ghep.pdf');
});
test('trùng tên thêm (2)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsp-paths-'));
  fs.writeFileSync(path.join(dir, 'a-ghep.pdf'), 'x');
  assert.equal(path.basename(uniquePath(dir, 'a-ghep.pdf')), 'a-ghep (2).pdf');
  fs.rmSync(dir, { recursive: true, force: true });
});
test('binaryPath theo dev/packaged', () => {
  assert.match(binaryPath('qpdf.exe', { appRoot: 'C:/app', isPackaged: false, resourcesPath: '' }), /app[\\/]bin[\\/]win32-x64[\\/]qpdf\.exe$/);
  assert.match(binaryPath('qpdf.exe', { appRoot: 'C:/app', isPackaged: true, resourcesPath: 'C:/res' }), /res[\\/]bin[\\/]win32-x64[\\/]qpdf\.exe$/);
});
test('moveAtomic chuyển file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsp-move-'));
  fs.writeFileSync(path.join(dir, 'a'), 'x');
  moveAtomic(path.join(dir, 'a'), path.join(dir, 'b'));
  assert.equal(fs.readFileSync(path.join(dir, 'b'), 'utf8'), 'x');
  assert.equal(fs.existsSync(path.join(dir, 'a')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 5: Cài đặt schema + paths**

Tạo `app/suite/schema.js`:

```js
const { ToolError } = require('./errors');

function validateOptions(tool, input = {}) {
  const defs = tool.options || [];
  const out = {};
  for (const opt of defs) {
    const v = input[opt.key];
    if (v === undefined) {
      if (opt.default !== undefined) out[opt.key] = opt.default;
      else if (opt.required) throw invalid(opt);
      continue;
    }
    switch (opt.type) {
      case 'bool':
        out[opt.key] = !!v;
        break;
      case 'int': {
        const n = Number(v);
        if (!Number.isInteger(n) || n < (opt.min ?? -Infinity) || n > (opt.max ?? Infinity)) throw invalid(opt);
        out[opt.key] = n;
        break;
      }
      case 'enum':
        if (!opt.values.includes(v)) throw invalid(opt);
        out[opt.key] = v;
        break;
      case 'range':
        if (typeof v !== 'string') throw invalid(opt);
        out[opt.key] = v;
        break;
      case 'password':
      case 'text':
        if (typeof v !== 'string' || v.length > 500) throw invalid(opt);
        out[opt.key] = v;
        break;
      default:
        throw invalid(opt);
    }
  }
  for (const key of Object.keys(input)) {
    if (!defs.some(o => o.key === key)) {
      throw new ToolError('INVALID_OPTIONS', `Tuỳ chọn không hợp lệ: ${key}`);
    }
  }
  return out;
}

function invalid(opt) {
  return new ToolError('INVALID_OPTIONS', `Giá trị không hợp lệ cho ${opt.label || opt.key}.`);
}

module.exports = { validateOptions };
```

Tạo `app/suite/util/paths.js`:

```js
const fs = require('node:fs');
const path = require('node:path');

function binaryPath(name, { appRoot, isPackaged, resourcesPath }) {
  if (process.env.TSP_BIN_DIR) return path.join(process.env.TSP_BIN_DIR, name);
  return isPackaged
    ? path.join(resourcesPath, 'bin', 'win32-x64', name)
    : path.join(appRoot, 'bin', 'win32-x64', name);
}

function splitExt(p) {
  const ext = path.extname(p);
  return { base: path.basename(p, ext), ext };
}

function outputName(input, suffix) {
  return `${splitExt(input).base}-${suffix}.pdf`;
}

function uniquePath(dir, name, exists = fs.existsSync) {
  let candidate = path.join(dir, name);
  if (!exists(candidate)) return candidate;
  const { base, ext } = splitExt(name);
  for (let i = 2; i < 10000; i++) {
    candidate = path.join(dir, `${base} (${i})${ext}`);
    if (!exists(candidate)) return candidate;
  }
  throw new Error('Không tìm được tên file trống');
}

function moveAtomic(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  try {
    fs.renameSync(src, dst);
  } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    const tmp = `${dst}.tmp-${process.pid}`;
    fs.copyFileSync(src, tmp);
    fs.renameSync(tmp, dst);
    fs.unlinkSync(src);
  }
}

module.exports = { binaryPath, splitExt, outputName, uniquePath, moveAtomic };
```

- [ ] **Step 6: Chạy test**

Run: `cd app && npm run test:tools`
Expected: PASS (qpdf + pages + schema + paths).

- [ ] **Step 7: Commit**

```bash
git add app/suite app/test/suite-unit
git commit -m "M1a: parser khoảng trang, schema tuỳ chọn và tiện ích đường dẫn"
```

---

## Task 3: Job runner, spawn và log

**Files:**
- Create: `app/suite/jobs.js`, `app/suite/util/spawn.js`, `app/suite/util/log.js`
- Test: `app/test/suite-unit/jobs.test.mjs`, `app/test/suite-unit/spawn.test.mjs`, `app/test/suite-unit/log.test.mjs`

**Interfaces:**
- Produces:
  - `class JobRunner { constructor({tools, onEvent, qpdfPath, tempRoot, concurrency=2, log}) ; start({toolId,files,options,outputDir}) -> jobId ; cancel(jobId) -> boolean }`
  - `runProcess(file, args, {signal,cwd,env,timeoutMs}) -> Promise<{stdout,stderr,code}>`
  - `createLogger(file, {maxBytes,keep}) -> (message) => void`

- [ ] **Step 1: Viết test runner**

Tạo `app/test/suite-unit/jobs.test.mjs`:

```js
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
```

- [ ] **Step 2: Chạy test để thấy fail**

Run: `cd app && npm run test:tools`
Expected: FAIL vì `suite/jobs.js` chưa có.

- [ ] **Step 3: Cài đặt spawn + log**

Tạo `app/suite/util/spawn.js`:

```js
const { spawn, execFileSync } = require('node:child_process');

function runProcess(file, args, { signal, cwd, env, timeoutMs = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd, env, windowsHide: true, shell: false });
    let stdout = '', stderr = '', settled = false, timer;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      fn(value);
    };
    const killTree = () => {
      try {
        if (process.platform === 'win32') {
          execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        } else {
          child.kill('SIGKILL');
        }
      } catch { /* tiến trình có thể đã thoát */ }
    };
    const onAbort = () => {
      killTree();
      finish(reject, Object.assign(new Error('Đã huỷ'), { code: 'CANCELLED' }));
    };

    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', e => finish(reject, e));
    child.on('close', code => {
      if (code === 0) finish(resolve, { stdout, stderr, code });
      else finish(reject, Object.assign(new Error(stderr.trim() || `Lỗi (mã ${code})`), {
        code: 'PROCESS_FAILED', exitCode: code, stderr,
      }));
    });

    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
    }
    if (timeoutMs) {
      timer = setTimeout(() => {
        killTree();
        finish(reject, Object.assign(new Error('Quá thời gian'), { code: 'TIMEOUT' }));
      }, timeoutMs);
    }
  });
}

module.exports = { runProcess };
```

Tạo `app/suite/util/log.js`:

```js
const fs = require('node:fs');
const path = require('node:path');

function createLogger(file, { maxBytes = 2 * 1024 * 1024, keep = 3 } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return message => {
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > maxBytes) {
        for (let i = keep - 1; i >= 1; i--) {
          const from = i === 1 ? file : `${file}.${i - 1}`;
          const to = `${file}.${i}`;
          if (fs.existsSync(from)) fs.renameSync(from, to);
        }
      }
      fs.appendFileSync(file, `[${new Date().toISOString()}] ${message}\n`);
    } catch { /* log không được làm hỏng job */ }
  };
}

module.exports = { createLogger };
```

- [ ] **Step 4: Cài đặt JobRunner**

Tạo `app/suite/jobs.js`:

```js
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { ToolError, toPayload } = require('./errors');
const { validateOptions } = require('./schema');
const { runProcess } = require('./util/spawn');

class JobRunner {
  constructor({ tools, onEvent, qpdfPath, tempRoot, concurrency = 2, log = () => {} }) {
    this.tools = new Map(tools.map(t => [t.id, t]));
    this.onEvent = onEvent;
    this.qpdfPath = qpdfPath;
    this.tempRoot = tempRoot || path.join(os.tmpdir(), 'TrinhSuaPDF', 'jobs');
    this.concurrency = concurrency;
    this.log = log;
    this.queue = [];
    this.running = new Map();
    fs.mkdirSync(this.tempRoot, { recursive: true });
  }

  start({ toolId, files, options, outputDir }) {
    const tool = this.tools.get(toolId);
    if (!tool || tool.status !== 'available' || typeof tool.run !== 'function') {
      throw new ToolError('UNSUPPORTED', 'Công cụ này chưa sẵn sàng.');
    }
    if (!Array.isArray(files) || !files.length) throw new ToolError('INVALID_FILE', 'Chưa chọn file.');
    if (tool.multiple === false && files.length !== 1) throw new ToolError('INVALID_FILE', 'Công cụ này chỉ nhận một file.');
    if (tool.minFiles && files.length < tool.minFiles) throw new ToolError('INVALID_FILE', `Cần ít nhất ${tool.minFiles} file.`);
    for (const f of files) {
      if (typeof f !== 'string' || !fs.existsSync(f) || !fs.statSync(f).isFile()) {
        throw new ToolError('INVALID_FILE', 'File không tồn tại.');
      }
      if (Array.isArray(tool.accept)) {
        const ext = path.extname(f).toLowerCase();
        if (!tool.accept.includes(ext)) {
          throw new ToolError('INVALID_FILE', `Định dạng không hỗ trợ: ${path.basename(f)}.`);
        }
      }
    }
    const job = {
      id: randomUUID(), tool, files, options: validateOptions(tool, options),
      outputDir: outputDir || null, controller: new AbortController(), state: 'queued',
    };
    this.queue.push(job);
    this.#emit(job, { type: 'queued' });
    this.#pump();
    return job.id;
  }

  cancel(id) {
    const running = this.running.get(id);
    if (running) { running.controller.abort(); return true; }
    const queued = this.queue.find(j => j.id === id);
    if (!queued) return false;
    this.queue = this.queue.filter(j => j !== queued);
    queued.state = 'cancelled';
    this.#emit(queued, { type: 'cancelled' });
    return true;
  }

  #pump() {
    while (this.running.size < this.concurrency && this.queue.length) {
      const job = this.queue.shift();
      if (job.controller.signal.aborted) continue;
      job.state = 'running';
      this.running.set(job.id, job);
      this.#run(job).finally(() => {
        this.running.delete(job.id);
        this.#pump();
      });
    }
  }

  async #run(job) {
    const tempDir = fs.mkdtempSync(path.join(this.tempRoot, `${job.id.slice(0, 8)}-`));
    const ctx = {
      jobId: job.id,
      files: job.files,
      options: job.options,
      outputDir: job.outputDir,
      tempDir,
      signal: job.controller.signal,
      log: this.log,
      progress: (phase, current, total, message) => this.#progress(job, { phase, current, total, message }),
      qpdf: (args, opts = {}) => runProcess(this.qpdfPath, args, { ...opts, signal: job.controller.signal }),
    };
    const started = Date.now();
    try {
      this.#emit(job, { type: 'started' });
      ctx.progress('reading', 0, 1, 'Đang đọc file…');
      const result = await job.tool.run(ctx);
      if (job.controller.signal.aborted) throw new ToolError('CANCELLED', 'Đã huỷ');
      const outputs = (result?.outputs || []).map(o => ({
        ...o,
        bytes: fs.existsSync(o.path) ? fs.statSync(o.path).size : 0,
      }));
      if (!outputs.length) throw new ToolError('INTERNAL', 'Không tạo được file kết quả.');
      job.state = 'done';
      this.#emit(job, {
        type: 'done', outputs, errors: result?.errors || [],
        stats: { ...(result?.stats || {}), ms: Date.now() - started },
      });
    } catch (e) {
      const cancelled = job.controller.signal.aborted || e.code === 'CANCELLED';
      this.log(`job ${job.id} ${cancelled ? 'cancelled' : 'error'}: ${e.stack || e.message}`);
      job.state = cancelled ? 'cancelled' : 'error';
      if (cancelled) this.#emit(job, { type: 'cancelled' });
      else this.#emit(job, { type: 'error', error: toPayload(e) });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
      this.log(`job ${job.id} finished in ${Date.now() - started}ms`);
    }
  }

  #progress(job, data) {
    const now = Date.now();
    if (job._lastProgress && now - job._lastProgress < 100 && data.current !== data.total) return;
    job._lastProgress = now;
    this.#emit(job, { type: 'progress', ...data });
  }

  #emit(job, data) {
    try { this.onEvent?.({ jobId: job.id, toolId: job.tool.id, ...data }); }
    catch (e) { this.log(`onEvent error: ${e.message}`); }
  }
}

module.exports = { JobRunner };
```

- [ ] **Step 5: Viết test spawn/log**

Tạo `app/test/suite-unit/spawn.test.mjs`:

```js
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
```

Tạo `app/test/suite-unit/log.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createLogger } = require('../../suite/util/log.js');

test('ghi và xoay vòng log', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsp-log-'));
  const file = path.join(dir, 'tools.log');
  const log = createLogger(file, { maxBytes: 40, keep: 2 });
  log('12345678901234567890');
  log('12345678901234567890');
  log('sau khi xoay');
  assert.ok(fs.existsSync(`${file}.1`));
  assert.match(fs.readFileSync(file, 'utf8'), /sau khi xoay/);
  fs.rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 6: Chạy test**

Run: `cd app && npm run test:tools`
Expected: PASS toàn bộ.

- [ ] **Step 7: Commit**

```bash
git add app/suite/jobs.js app/suite/util app/test/suite-unit
git commit -m "M1a: job runner, spawn không shell và log xoay vòng"
```

---

## Task 4: Chuyển editor sang editor.html, giữ test cũ xanh

**Files:**
- Rename: `app/renderer/index.html` → `app/renderer/editor.html`
- Create: `app/renderer/index.html` (placeholder tạm)
- Modify: `app/main.js`, `app/preload.js`, `app/renderer/app.js`, `app/renderer/editor.html`

**Interfaces:**
- Produces:
  - `window.api.suite.goHome()`, `window.api.suite.openEditor(path?)`
  - Entry: có file → `editor.html`; production không file → `index.html`; test cũ (`TSP_NO_SINGLE_INSTANCE=1`) không file → `editor.html`; `TSP_SUITE=1` → `index.html`.

- [ ] **Step 1: Đổi tên và tạo placeholder**

```bash
cd app/renderer
git mv index.html editor.html
```

Tạo `app/renderer/index.html`:

```html
<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<title>Trình sửa PDF</title>
</head>
<body>
<p id="boot">Đang tải…</p>
</body>
</html>
```

- [ ] **Step 2: Sửa entry trong main.js**

Trong `app/main.js`, thêm biến cạnh `let win = null;`:

```js
let currentEntry = 'index.html';
```

Thay dòng `win.loadURL('app://local/index.html');` bằng:

```js
loadEntry(startEntry());
```

Thêm các hàm trước `createWindow()`:

```js
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
```

Sửa `second-instance`:

```js
app.on('second-instance', (_e, argv) => {
  const f = pdfFromArgv(argv);
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
  if (!f) return;
  if (currentEntry === 'editor.html') win.webContents.send('open-path', f);
  else openEditor(f);
});
```

Thêm IPC trong khối `whenReady().then(...)` (sau các handler hiện có):

```js
ipcMain.handle('suite:go-home', () => { dirty = false; loadEntry('index.html'); return true; });
ipcMain.handle('suite:open-editor', (_e, p) => { openEditor(p); return true; });
```

- [ ] **Step 3: Thêm API vào preload**

Trong `app/preload.js`, thêm vào object `api`:

```js
suite: {
  goHome: () => ipcRenderer.invoke('suite:go-home'),
  openEditor: p => ipcRenderer.invoke('suite:open-editor', p),
},
```

- [ ] **Step 4: Thêm nút Trang chủ vào editor**

Trong `app/renderer/editor.html`, ngay sau `<div class="bar">`, thêm:

```html
<button id="homeBtn" title="Về trang chủ">← Trang chủ</button>
```

Trong `app/renderer/app.js`, gần phần phím tắt (trước `window.addEventListener('keydown'`), thêm:

```js
const homeBtn = document.getElementById('homeBtn');
if (homeBtn) homeBtn.onclick = async () => {
  if (dirty && !confirm('Bạn có chỉnh sửa chưa lưu. Về trang chủ và bỏ các chỉnh sửa này?')) return;
  API?.setDirty?.(false);
  if (API?.suite?.goHome) await API.suite.goHome();
  else location.href = 'index.html';
};
```

- [ ] **Step 5: Chạy test editor cũ**

Run:

```bash
cd app
npm test
npm run test:e2e
```

Expected: PASS, không cần sửa test nào. Nếu fail, kiểm tra `startEntry()` và đường dẫn `editor.html`.

- [ ] **Step 6: Commit**

```bash
git add app/main.js app/preload.js app/renderer/app.js app/renderer/editor.html app/renderer/index.html
git commit -m "M1a: tách editor.html và thêm entry home mà không đổi test cũ"
```

---

## Task 5: Registry, IPC đọc và health qpdf

**Files:**
- Create: `app/suite/registry.js`
- Modify: `app/main.js`, `app/preload.js`
- Test: `app/test/suite-unit/registry.test.mjs`

**Interfaces:**
- Produces:
  - `listTools() -> public manifest[]` (14 công cụ, `merge` khả dụng ở M1a)
  - IPC `suite:tools`, `suite:health`, `suite:pick-files`, `suite:pick-output`, `suite:reveal`
  - `window.api.suite.tools/health/pickFiles/pickOutput/reveal`

- [ ] **Step 1: Viết test registry**

Tạo `app/test/suite-unit/registry.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { listTools } = require('../../suite/registry.js');

test('có đủ 14 công cụ, id duy nhất', () => {
  const tools = listTools();
  assert.equal(tools.length, 14);
  assert.equal(new Set(tools.map(t => t.id)).size, 14);
});
test('mỗi công cụ có trường bắt buộc', () => {
  for (const t of listTools()) {
    for (const k of ['id', 'group', 'title', 'description', 'accept', 'status']) {
      assert.ok(t[k] !== undefined, `${t.id} thiếu ${k}`);
    }
  }
});
test('merge khả dụng, các công cụ khác đang chờ', () => {
  const tools = listTools();
  assert.equal(tools.find(t => t.id === 'merge').status, 'available');
  assert.ok(tools.filter(t => t.status === 'planned').length >= 10);
});
test('không lộ hàm run qua IPC', () => {
  for (const t of listTools()) assert.equal(t.run, undefined);
});
```

- [ ] **Step 2: Chạy test để thấy fail**

Run: `cd app && npm run test:tools`
Expected: FAIL vì chưa có registry.

- [ ] **Step 3: Tạo registry**

Tạo `app/suite/registry.js`:

```js
const TOOLS = [
  { id: 'merge', group: 'organize', title: 'Ghép PDF', description: 'Ghép nhiều file thành một, đổi được thứ tự.', icon: '⧉', accept: ['.pdf'], multiple: true, minFiles: 2, status: 'available', options: [] },
  { id: 'split', group: 'organize', title: 'Tách PDF', description: 'Tách theo khoảng trang hoặc từng trang.', icon: '✂', accept: ['.pdf'], multiple: false, status: 'planned', options: [] },
  { id: 'pages', group: 'organize', title: 'Xoá & trích trang', description: 'Chọn trang để xoá hoặc trích thành file mới.', icon: '▤', accept: ['.pdf'], multiple: false, status: 'planned', options: [] },
  { id: 'organize', group: 'organize', title: 'Tổ chức trang', description: 'Đổi thứ tự, xoay, nhân bản, chèn trang trắng.', icon: '⇅', accept: ['.pdf'], multiple: false, status: 'planned', options: [] },
  { id: 'crop', group: 'organize', title: 'Crop PDF', description: 'Cắt lề trang theo khung tuỳ chọn.', icon: '⌗', accept: ['.pdf'], multiple: false, status: 'planned', options: [] },
  { id: 'stamp', group: 'stamp', title: 'Số trang & header/footer', description: 'Đánh số trang và chèn tiêu đề/chân trang.', icon: '#', accept: ['.pdf'], multiple: false, status: 'planned', options: [] },
  { id: 'watermark', group: 'stamp', title: 'Watermark', description: 'Chèn chữ hoặc ảnh mờ lên trang.', icon: '◈', accept: ['.pdf'], multiple: false, status: 'planned', options: [] },
  { id: 'pdf-images', group: 'convert', title: 'PDF → ảnh', description: 'Xuất từng trang thành JPG hoặc PNG.', icon: '🖼', accept: ['.pdf'], multiple: false, status: 'planned', options: [] },
  { id: 'images-pdf', group: 'convert', title: 'Ảnh → PDF', description: 'Ghép ảnh thành một PDF theo thứ tự.', icon: '🖼', accept: ['.png', '.jpg', '.jpeg'], multiple: true, minFiles: 1, status: 'planned', options: [] },
  { id: 'html-pdf', group: 'convert', title: 'HTML → PDF', description: 'In file HTML local thành PDF.', icon: '⟨/⟩', accept: ['.html', '.htm'], multiple: false, status: 'planned', options: [] },
  { id: 'compress', group: 'optimize', title: 'Nén PDF', description: 'Giảm dung lượng, có cảnh báo mất lớp chữ.', icon: '🗜', accept: ['.pdf'], multiple: false, status: 'planned', options: [] },
  { id: 'protect', group: 'security', title: 'Khoá PDF', description: 'Đặt mật khẩu mở và hạn chế quyền.', icon: '🔒', accept: ['.pdf'], multiple: false, status: 'planned', options: [] },
  { id: 'unlock', group: 'security', title: 'Mở khoá PDF', description: 'Gỡ mã hoá khi biết mật khẩu.', icon: '🔓', accept: ['.pdf'], multiple: false, status: 'planned', options: [] },
  { id: 'metadata', group: 'security', title: 'Xoá metadata', description: 'Xoá thông tin tác giả, XMP và tệp đính kèm.', icon: '🧹', accept: ['.pdf'], multiple: false, status: 'planned', options: [] },
];

function listTools() {
  return TOOLS.map(({ run, ...pub }) => ({ ...pub }));
}

function getTools() {
  return TOOLS;
}

module.exports = { listTools, getTools };
```

- [ ] **Step 4: Thêm IPC và health vào main.js**

Đầu `app/main.js`, thêm `require` (suite là CommonJS):

```js
const { listTools, getTools } = require('./suite/registry');
const { JobRunner } = require('./suite/jobs');
const { binaryPath } = require('./suite/util/paths');
const { runProcess } = require('./suite/util/spawn');
const { createLogger } = require('./suite/util/log');
```

Trong khối `whenReady().then(...)`, thêm các handler sau (đăng ký trước khi cửa sổ mở):

```js
let healthCache = null;
ipcMain.handle('suite:tools', () => listTools());
ipcMain.handle('suite:health', async () => {
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
});
ipcMain.handle('suite:pick-files', async (_e, { accept = ['.pdf'], multiple = false } = {}) => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Chọn file', properties: multiple ? ['openFile', 'multiSelections'] : ['openFile'],
    filters: [{ name: 'Tài liệu', extensions: accept.map(a => a.replace('.', '')) }],
  });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle('suite:pick-output', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Chọn thư mục xuất', properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('suite:reveal', (_e, p) => {
  if (typeof p !== 'string' || !fs.existsSync(p)) return false;
  if (fs.statSync(p).isDirectory()) shell.openPath(p);
  else shell.showItemInFolder(p);
  return true;
});
```

- [ ] **Step 5: Mở API trong preload**

Thêm vào `api.suite` (cùng `goHome`, `openEditor`):

```js
tools: () => ipcRenderer.invoke('suite:tools'),
health: () => ipcRenderer.invoke('suite:health'),
pickFiles: opts => ipcRenderer.invoke('suite:pick-files', opts),
pickOutput: () => ipcRenderer.invoke('suite:pick-output'),
reveal: p => ipcRenderer.invoke('suite:reveal', p),
```

- [ ] **Step 6: Chạy test**

Run: `cd app && npm run test:tools`
Expected: PASS (registry + tests cũ trong bộ).

- [ ] **Step 7: Commit**

```bash
git add app/suite/registry.js app/main.js app/preload.js app/test/suite-unit/registry.test.mjs
git commit -m "M1a: registry 14 công cụ, IPC chọn file và health qpdf"
```

---

## Task 6: Shell home/tool và design token

**Files:**
- Create: `app/renderer/ui/tokens.css`, `app/renderer/suite.css`, `app/renderer/index.html` (thay placeholder), `app/renderer/suite.js`

**Interfaces:**
- Consumes: `window.api.suite.tools/health/pickFiles/pickOutput/reveal/openEditor`.
- Produces: `window.__suite = { state, openTool, addFiles, setOutputDir, run, waitJob, tools }` cho test; home/tool view.

- [ ] **Step 1: Viết HTML shell**

Thay nội dung `app/renderer/index.html` bằng:

```html
<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:">
<title>Trình sửa PDF</title>
<link rel="stylesheet" href="ui/tokens.css">
<link rel="stylesheet" href="suite.css">
</head>
<body>
<div class="shell">
  <aside class="rail">
    <div class="brand"><span class="logo">✍</span><span>Trình sửa PDF</span></div>
    <nav id="nav"></nav>
    <button class="railFoot" id="settingsBtn" disabled title="Sắp có">Cài đặt</button>
  </aside>
  <div class="workspace">
    <section id="homeView" class="view">
      <header class="topbar">
        <div>
          <h1>Bộ công cụ PDF</h1>
          <p class="sub">Chạy ngoại tuyến · không tải file lên mạng</p>
        </div>
        <input id="toolSearch" type="search" placeholder="Tìm công cụ…" autocomplete="off">
        <button class="btn primary" id="editBtn">✎ Chỉnh sửa PDF</button>
      </header>
      <div class="dropZone" id="dropZone">Kéo thả PDF hoặc ảnh vào đây</div>
      <div id="toolGrid"></div>
      <p class="empty" id="noResults" hidden>Không tìm thấy công cụ nào.</p>
    </section>

    <section id="toolView" class="view" hidden>
      <header class="topbar">
        <button class="btn ghost" id="backBtn">← Trang chủ</button>
        <h1 id="toolTitle"></h1>
        <span class="badge" id="toolBadge" hidden>Sắp có</span>
      </header>
      <div class="toolBody">
        <div class="pane filesPane">
          <div class="dropZone small" id="toolDrop">Kéo thả file vào đây</div>
          <ul id="fileList" class="fileList"></ul>
          <button class="btn" id="addFilesBtn">+ Thêm file</button>
        </div>
        <div class="pane optionsPane">
          <div id="options"></div>
          <div class="outRow">
            <button class="btn" id="outBtn">Chọn thư mục xuất…</button>
            <span id="outLabel" class="muted">Cùng thư mục file gốc</span>
          </div>
          <div class="actions">
            <button class="btn primary" id="runBtn" disabled>Chạy</button>
            <button class="btn ghost" id="cancelBtn" hidden>Huỷ</button>
          </div>
          <div id="progress" class="progress" hidden>
            <progress id="progressBar" max="1" value="0"></progress>
            <span id="progressText" class="muted"></span>
          </div>
          <div id="result" class="result" hidden></div>
        </div>
      </div>
    </section>
  </div>
</div>
<div id="toast"></div>
<script type="module" src="suite.js"></script>
</body>
</html>
```

- [ ] **Step 2: Viết token và CSS**

Tạo `app/renderer/ui/tokens.css`:

```css
@font-face{font-family:"Be Vietnam Pro";src:url(../fonts/BeVietnamPro-Regular.ttf);font-weight:400}
@font-face{font-family:"Be Vietnam Pro";src:url(../fonts/BeVietnamPro-Medium.ttf);font-weight:500}
@font-face{font-family:"Be Vietnam Pro";src:url(../fonts/BeVietnamPro-SemiBold.ttf);font-weight:600 700}
:root{
  --blue:#0b5cd5;--blue-d:#0a47a6;--ink:#1a2a7a;--bg:#e9edf3;--panel:#fff;
  --line:#d7dde6;--txt:#1f2937;--mut:#6b7280;--warn:#b45309;--ok:#10b981;
  --r:10px;--r-lg:14px;--gap:12px;--pad:16px;
  --shadow:0 8px 24px rgba(15,23,42,.10);
}
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{font-family:"Be Vietnam Pro","Segoe UI",system-ui,sans-serif;color:var(--txt);background:var(--bg);overflow:hidden}
button,input,select{font:inherit}
button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid #93b4f5;outline-offset:2px}
.btn{height:34px;padding:0 12px;border:1px solid var(--line);border-radius:var(--r);background:var(--panel);color:var(--txt);cursor:pointer;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.btn:hover:not(:disabled){background:#f3f6fb;border-color:#c3ccd9}
.btn:disabled{opacity:.45;cursor:not-allowed}
.btn.primary{background:var(--blue);border-color:var(--blue);color:#fff;font-weight:600}
.btn.primary:hover:not(:disabled){background:var(--blue-d)}
.btn.ghost{background:transparent}
.muted{color:var(--mut);font-size:12.5px}
.badge{font-size:11px;font-weight:600;color:var(--warn);background:#fff7ed;border:1px solid #fed7aa;border-radius:999px;padding:3px 8px}
```

Tạo `app/renderer/suite.css`:

```css
.shell{display:flex;height:100%}
.rail{width:232px;flex:none;background:var(--panel);border-right:1px solid var(--line);display:flex;flex-direction:column;padding:14px 10px}
.brand{display:flex;align-items:center;gap:9px;font-weight:700;padding:4px 8px 16px;font-size:15px}
.logo{width:30px;height:30px;border-radius:9px;background:linear-gradient(135deg,#0b5cd5,#3b82f6);display:grid;place-items:center;color:#fff}
#nav{display:flex;flex-direction:column;gap:2px;overflow:auto}
.navItem{height:34px;border:0;background:transparent;text-align:left;padding:0 10px;border-radius:8px;color:var(--txt);cursor:pointer;font-size:13.5px}
.navItem:hover{background:#f1f5fd}.navItem.on{background:#e6efff;color:var(--blue-d);font-weight:600}
.railFoot{margin-top:auto;height:34px;border:1px solid var(--line);background:var(--panel);border-radius:8px;color:var(--mut);cursor:not-allowed}
.workspace{flex:1;min-width:0;display:flex;flex-direction:column}
.view{flex:1;min-height:0;display:flex;flex-direction:column;padding:18px 22px 26px;overflow:auto}
.view[hidden]{display:none}
.topbar{display:flex;align-items:center;gap:14px;margin-bottom:16px;flex-wrap:wrap}
.topbar h1{font-size:22px;margin:0}
.sub{margin:3px 0 0;color:var(--mut);font-size:12.5px}
#toolSearch{width:min(320px,40vw);height:34px;border:1px solid var(--line);border-radius:var(--r);padding:0 12px;background:var(--panel);margin-left:auto}
.dropZone{border:2px dashed #b9c5d6;border-radius:var(--r-lg);background:#fff;padding:22px;text-align:center;color:var(--mut);margin-bottom:18px}
.dropZone.small{padding:14px;margin:0 0 10px;font-size:13px}
.dropZone.over{border-color:var(--blue);background:#eef4ff}
#toolGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
.groupTitle{grid-column:1/-1;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--mut);margin:12px 2px 0}
.card{display:flex;align-items:flex-start;gap:10px;text-align:left;border:1px solid var(--line);background:var(--panel);border-radius:var(--r-lg);padding:14px;cursor:pointer;min-height:84px}
.card:hover:not(:disabled){border-color:#9db8e8;box-shadow:var(--shadow)}
.card:disabled{opacity:.62;cursor:not-allowed}
.card .ic{width:34px;height:34px;flex:none;border-radius:9px;background:#eef4ff;display:grid;place-items:center;font-size:17px}
.card b{display:block;font-size:14px;margin-bottom:3px}
.card span{font-size:12.5px;color:var(--mut);line-height:1.4}
.card .st{margin-left:auto;font-size:10.5px;color:var(--warn);white-space:nowrap}
.empty{color:var(--mut);text-align:center;padding:40px}
.toolBody{display:grid;grid-template-columns:minmax(260px,1fr) minmax(300px,420px);gap:16px;align-items:start}
@media (max-width:1000px){.toolBody{grid-template-columns:1fr}}
.pane{background:var(--panel);border:1px solid var(--line);border-radius:var(--r-lg);padding:14px}
.fileList{list-style:none;margin:0 0 10px;padding:0;display:flex;flex-direction:column;gap:6px;max-height:52vh;overflow:auto}
.fileItem{display:flex;align-items:center;gap:6px;border:1px solid #eef1f5;border-radius:8px;padding:7px 8px;font-size:13px;background:#fafbfd}
.fileItem .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fileItem button{height:24px;width:26px;padding:0;border:0;background:transparent;border-radius:6px;cursor:pointer;color:var(--mut)}
.fileItem button:hover{background:#eef2f8;color:var(--txt)}
.field{display:flex;flex-direction:column;gap:5px;margin-bottom:12px}
.field label{font-size:12.5px;color:var(--mut)}
.field input[type=text],.field input[type=password],.field input[type=number],.field select{height:34px;border:1px solid var(--line);border-radius:9px;padding:0 10px;background:#fff;color:var(--txt)}
.field .row{display:flex;align-items:center;gap:8px}
.outRow{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:12px 0}
.actions{display:flex;gap:8px;margin-top:8px}
.progress{margin-top:12px;display:flex;flex-direction:column;gap:6px}
.progress progress{width:100%;height:8px;accent-color:var(--blue)}
.result{margin-top:14px;border-top:1px solid var(--line);padding-top:12px;font-size:13px}
.result .ok{color:#047857;font-weight:600}
.result .err{color:#b91c1c}
.result ul{margin:8px 0;padding-left:18px}
.result .row{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
#toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%) translateY(16px);background:#111827;color:#fff;padding:9px 16px;border-radius:10px;font-size:13.5px;opacity:0;pointer-events:none;transition:.2s;z-index:50}
#toast.show{opacity:1;transform:translateX(-50%)}
```

- [ ] **Step 3: Viết suite.js**

Tạo `app/renderer/suite.js`:

```js
const API = window.api;
const S = API?.suite;
const $ = id => document.getElementById(id);
const GROUPS = [
  ['organize', 'Tổ chức'], ['stamp', 'Đánh dấu'], ['convert', 'Chuyển đổi'],
  ['optimize', 'Tối ưu'], ['security', 'Bảo mật'],
];
const state = {
  tools: [], tool: null, files: [], options: {}, outputDir: null,
  jobId: null, running: false, lastResult: null, lastError: null,
  search: '', group: null,
};
const pendingJobEvents = [];

const baseName = p => String(p).split(/[\\/]/).pop();
const toast = (msg, ms = 3000) => {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms);
};

function renderNav() {
  const nav = $('nav');
  nav.innerHTML = '';
  const all = document.createElement('button');
  all.className = 'navItem' + (state.group ? '' : ' on');
  all.textContent = 'Trang chủ';
  all.onclick = () => { state.group = null; renderNav(); renderGrid(); };
  nav.appendChild(all);
  for (const [key, label] of GROUPS) {
    const b = document.createElement('button');
    b.className = 'navItem' + (state.group === key ? ' on' : '');
    b.textContent = label;
    b.onclick = () => { state.group = key; renderNav(); renderGrid(); };
    nav.appendChild(b);
  }
}

function renderGrid() {
  const grid = $('toolGrid');
  grid.innerHTML = '';
  const q = state.search.trim().toLowerCase();
  const visible = state.tools.filter(t =>
    (!state.group || t.group === state.group) &&
    (!q || (t.title + ' ' + t.description).toLowerCase().includes(q)));
  for (const [key, label] of GROUPS) {
    if (state.group && state.group !== key) continue;
    const items = visible.filter(t => t.group === key);
    if (!items.length) continue;
    const h = document.createElement('div'); h.className = 'groupTitle'; h.textContent = label;
    grid.appendChild(h);
    for (const t of items) {
      const b = document.createElement('button');
      b.className = 'card'; b.disabled = t.status !== 'available';
      b.innerHTML = `<span class="ic"></span><span><b></b><span></span></span>${t.status !== 'available' ? '<span class="st">Sắp có</span>' : ''}`;
      b.querySelector('.ic').textContent = t.icon || '▧';
      b.querySelector('b').textContent = t.title;
      b.querySelector('span span').textContent = t.description;
      b.onclick = () => { location.hash = '#/tool/' + t.id; };
      grid.appendChild(b);
    }
  }
  $('noResults').hidden = visible.length > 0;
}

function route() {
  const m = /^#\/tool\/([\w-]+)$/.exec(location.hash);
  if (m) openTool(m[1]); else showHome();
}
function showHome() {
  state.tool = null;
  $('toolView').hidden = true; $('homeView').hidden = false;
}
async function openTool(id) {
  const tool = state.tools.find(t => t.id === id);
  if (!tool) return showHome();
  if (tool.status !== 'available') { toast('Công cụ này sẽ có ở đợt sau.'); location.hash = ''; return; }
  state.tool = tool; state.files = []; state.outputDir = null;
  state.lastResult = null; state.lastError = null; state.running = false;
  state.options = defaults(tool);
  $('homeView').hidden = true; $('toolView').hidden = false;
  $('toolTitle').textContent = tool.title;
  $('toolBadge').hidden = true;
  renderFiles(); renderOptions(); renderResult(); updateRun();
}
function defaults(tool) {
  const out = {};
  for (const o of tool.options || []) {
    out[o.key] = o.default !== undefined ? o.default
      : o.type === 'bool' ? false
        : o.type === 'int' ? (o.min ?? 0)
          : o.type === 'enum' ? o.values[0]
            : '';
  }
  return out;
}
function renderOptions() {
  const box = $('options'); box.innerHTML = '';
  for (const o of state.tool.options || []) {
    const f = document.createElement('div'); f.className = 'field';
    const label = document.createElement('label'); label.textContent = o.label || o.key;
    f.appendChild(label);
    if (o.type === 'bool') {
      const row = document.createElement('label'); row.className = 'row';
      const cb = document.createElement('input'); cb.type = 'checkbox';
      cb.checked = !!state.options[o.key];
      cb.onchange = () => { state.options[o.key] = cb.checked; };
      row.appendChild(cb); row.appendChild(document.createTextNode(o.hint || 'Bật'));
      f.appendChild(row);
    } else if (o.type === 'enum') {
      const sel = document.createElement('select');
      for (const v of o.values) {
        const op = document.createElement('option'); op.value = v; op.textContent = o.labels?.[v] || v;
        sel.appendChild(op);
      }
      sel.value = state.options[o.key];
      sel.onchange = () => { state.options[o.key] = sel.value; };
      f.appendChild(sel);
    } else {
      const inp = document.createElement('input');
      inp.type = o.type === 'int' ? 'number' : o.type === 'password' ? 'password' : 'text';
      if (o.type === 'int') { inp.min = o.min; inp.max = o.max; }
      inp.value = state.options[o.key] ?? '';
      inp.placeholder = o.placeholder || '';
      inp.oninput = () => { state.options[o.key] = o.type === 'int' ? Number(inp.value) : inp.value; };
      f.appendChild(inp);
    }
    box.appendChild(f);
  }
}
function renderFiles() {
  const list = $('fileList'); list.innerHTML = '';
  for (const [i, f] of state.files.entries()) {
    const li = document.createElement('li'); li.className = 'fileItem';
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = baseName(f); nm.title = f;
    li.appendChild(nm);
    if (state.tool.multiple) {
      const up = document.createElement('button'); up.textContent = '↑'; up.title = 'Lên';
      up.onclick = () => { if (i > 0) { [state.files[i - 1], state.files[i]] = [state.files[i], state.files[i - 1]]; renderFiles(); } };
      const dn = document.createElement('button'); dn.textContent = '↓'; dn.title = 'Xuống';
      dn.onclick = () => { if (i < state.files.length - 1) { [state.files[i + 1], state.files[i]] = [state.files[i], state.files[i + 1]]; renderFiles(); } };
      li.append(up, dn);
    }
    const rm = document.createElement('button'); rm.textContent = '✕'; rm.title = 'Bỏ file';
    rm.onclick = () => { state.files.splice(i, 1); renderFiles(); updateRun(); };
    li.appendChild(rm);
    list.appendChild(li);
  }
  updateRun();
}
function addFiles(paths) {
  if (!state.tool) return;
  const ext = p => String(p).toLowerCase().match(/\.[^.\\/]+$/)?.[0] || '';
  for (const p of paths) {
    if (!state.tool.accept.includes(ext(p))) { toast('File không đúng định dạng: ' + baseName(p)); continue; }
    if (!state.tool.multiple && state.files.length >= 1) state.files = [];
    state.files.push(p);
  }
  renderFiles();
}
async function pickFiles() {
  if (!S || !state.tool) return;
  const paths = await S.pickFiles({ accept: state.tool.accept, multiple: !!state.tool.multiple });
  addFiles(paths);
}
async function pickOutput() {
  if (!S) return;
  const dir = await S.pickOutput();
  if (dir) { state.outputDir = dir; $('outLabel').textContent = dir; }
}
function updateRun() {
  const min = state.tool?.minFiles || 1;
  $('runBtn').disabled = !state.tool || state.running || state.files.length < min || !S?.jobStart;
}
function renderResult() {
  const box = $('result');
  if (!state.lastResult && !state.lastError) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  if (state.lastError) {
    box.innerHTML = `<div class="err"></div>`;
    box.querySelector('.err').textContent = state.lastError.message || 'Không xử lý được. Thử lại.';
    return;
  }
  const r = state.lastResult;
  box.innerHTML = '<div class="ok"></div><ul></ul><div class="row"></div>';
  box.querySelector('.ok').textContent = `Xong · ${r.outputs.length} file`;
  for (const o of r.outputs) {
    const li = document.createElement('li');
    li.textContent = `${baseName(o.path)} · ${Math.max(1, Math.round((o.bytes || 0) / 1024))} KB`;
    box.querySelector('ul').appendChild(li);
  }
  const open = document.createElement('button'); open.className = 'btn'; open.textContent = 'Mở thư mục';
  open.onclick = () => S?.reveal(r.outputs[0]?.path);
  const again = document.createElement('button'); again.className = 'btn ghost'; again.textContent = 'Chạy lại';
  again.onclick = () => run();
  box.querySelector('.row').append(open, again);
}
async function run() {
  if (!S?.jobStart || !state.tool || state.running) return;
  state.running = true; state.lastResult = null; state.lastError = null;
  state.jobId = null; pendingJobEvents.length = 0;
  renderResult(); updateRun();
  $('progress').hidden = false; $('cancelBtn').hidden = false;
  $('progressBar').max = 1; $('progressBar').value = 0; $('progressText').textContent = 'Đang chuẩn bị…';
  try {
    const res = await S.jobStart({
      toolId: state.tool.id, files: state.files.slice(),
      options: state.options, outputDir: state.outputDir,
    });
    if (!res?.ok) {
      throw Object.assign(new Error(res?.error?.message || 'Không chạy được công cụ.'), { code: res?.error?.code });
    }
    state.jobId = res.jobId;
    // Event có thể về trước khi IPC trả jobId — phát lại sau khi biết id.
    const mine = pendingJobEvents.filter(e => e.jobId === state.jobId);
    pendingJobEvents.length = 0;
    for (const e of mine) onJob(e);
  } catch (e) {
    state.running = false; state.lastError = { message: e.message || 'Không chạy được công cụ.' };
    $('progress').hidden = true; $('cancelBtn').hidden = true;
    renderResult(); updateRun();
  }
}
async function cancel() {
  if (state.jobId) await S?.jobCancel?.(state.jobId);
}
function onJob(ev) {
  if (!state.jobId) { pendingJobEvents.push(ev); return; }
  if (ev.jobId !== state.jobId) return;
  if (ev.type === 'progress') {
    $('progressBar').max = ev.total || 1;
    $('progressBar').value = ev.current || 0;
    $('progressText').textContent = ev.message || '';
    return;
  }
  state.running = false;
  $('progress').hidden = true; $('cancelBtn').hidden = true; updateRun();
  if (ev.type === 'done') { state.lastResult = ev; renderResult(); }
  else if (ev.type === 'error') { state.lastError = ev.error; renderResult(); }
  else if (ev.type === 'cancelled') { toast('Đã huỷ job.'); }
  renderResult();
}
function bind() {
  $('editBtn').onclick = () => S?.openEditor();
  $('backBtn').onclick = () => { location.hash = ''; };
  $('toolSearch').oninput = () => { state.search = $('toolSearch').value; renderGrid(); };
  $('addFilesBtn').onclick = pickFiles;
  $('outBtn').onclick = pickOutput;
  $('runBtn').onclick = run;
  $('cancelBtn').onclick = cancel;
  window.addEventListener('hashchange', route);
  for (const id of ['dropZone', 'toolDrop']) {
    const dz = $(id);
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('over'));
    dz.addEventListener('drop', e => {
      e.preventDefault(); dz.classList.remove('over');
      const paths = [...(e.dataTransfer?.files || [])].map(f => API?.pathForFile?.(f)).filter(Boolean);
      if (state.tool) addFiles(paths);
      else toast(paths.length ? 'Chọn công cụ trước, rồi thêm file.' : 'Không đọc được file.');
    });
  }
  S?.onJobEvent?.(onJob);
}

(async function init() {
  bind();
  if (!S) { $('toolGrid').textContent = 'Chỉ chạy trong ứng dụng desktop.'; return; }
  state.tools = await S.tools();
  renderNav(); renderGrid(); route();
  const health = await S.health();
  if (!health.qpdf?.ok) toast('Thiếu qpdf nên công cụ ghép/khoá sẽ không chạy.', 6000);
})();

window.__suite = {
  state,
  tools: () => state.tools,
  openTool: async id => { location.hash = '#/tool/' + id; await new Promise(r => setTimeout(r, 60)); return state.tool?.id; },
  addFiles,
  setOutputDir: p => { state.outputDir = p; $('outLabel').textContent = p; },
  run,
  waitJob: (ms = 30000) => new Promise((resolve, reject) => {
    const t0 = Date.now();
    const t = setInterval(() => {
      if (!state.running) { clearInterval(t); resolve(state.lastResult || state.lastError); }
      else if (Date.now() - t0 > ms) { clearInterval(t); reject(new Error('timeout')); }
    }, 50);
  }),
};
```

- [ ] **Step 4: Chạy app để kiểm tra mắt**

Run: `cd app && npm start`
Expected: cửa sổ mở Trang chủ, thấy 14 thẻ, `Ghép PDF` bấm được, các thẻ khác ghi “Sắp có”; nút “Chỉnh sửa PDF” mở editor; nút “← Trang chủ” quay lại.

- [ ] **Step 5: Viết E2E home**

Tạo `app/test/suite-e2e.mjs` (phần home; phần merge thêm ở Task 7):

```js
import { _electron as electron } from 'playwright-core';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'node:module';
import { APP_ROOT, OUT, electronBin, electronEnv, closeApp } from './_paths.mjs';

const require = createRequire(import.meta.url);
fs.mkdirSync(OUT, { recursive: true });

const app = await electron.launch({
  executablePath: electronBin,
  args: [APP_ROOT, '--no-sandbox'],
  env: { ...electronEnv, TSP_SUITE: '1' },
});
const w = await app.firstWindow();
await w.setViewportSize({ width: 1400, height: 900 }).catch(() => {});
await w.waitForFunction(() => window.__suite?.tools().length === 14, null, { timeout: 30000 });
console.log('tools:', await w.evaluate(() => window.__suite.tools().length));
await w.fill('#toolSearch', 'ghép');
console.log('cards sau tìm:', await w.locator('#toolGrid .card').count());
await w.fill('#toolSearch', '');
await w.screenshot({ path: path.join(OUT, 'suite-home.png') });
await w.click('#editBtn');
await w.waitForFunction(() => !!window.__app, null, { timeout: 30000 });
console.log('editor mở được');
await closeApp(app);
```

- [ ] **Step 6: Chạy test**

```bash
cd app
npm run test:tools
npm run test:suite
```

Expected: PASS. Ảnh `test/out/suite-home.png` có home mới.

- [ ] **Step 7: Commit**

```bash
git add app/renderer/index.html app/renderer/suite.js app/renderer/suite.css app/renderer/ui/tokens.css app/test/suite-e2e.mjs
git commit -m "M1a: shell home/tool, design token và test E2E trang chủ"
```

---

## Task 7: Ghép PDF end-to-end

**Files:**
- Create: `app/suite/pdfops/organize.js`
- Modify: `app/suite/registry.js`, `app/main.js`, `app/preload.js`, `app/test/suite-e2e.mjs`
- Test: `app/test/suite-unit/merge.test.mjs`

**Interfaces:**
- Consumes: `ctx.qpdf(args)`, `ctx.progress`, `ctx.signal`, `uniquePath`, `outputName`, `moveAtomic`.
- Produces: tool `merge` chạy được; IPC `suite:job-start`, `suite:job-cancel`, event `suite:job-event`; `window.api.suite.jobStart/jobCancel/onJobEvent`.

- [ ] **Step 1: Viết unit test merge**

Tạo `app/test/suite-unit/merge.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PDFDocument } = require('pdf-lib');
const { merge } = require('../../suite/pdfops/organize.js');
const { ToolError } = require('../../suite/errors.js');
const { binaryPath } = require('../../suite/util/paths.js');
const { runProcess } = require('../../suite/util/spawn.js');
const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function makePdf(file, widths) {
  const doc = await PDFDocument.create();
  for (const w of widths) doc.addPage([w, 200]);
  fs.writeFileSync(file, await doc.save());
}

async function makeCtx(files, dir, qpdf = realQpdf) {
  return {
    files, tempDir: fs.mkdtempSync(path.join(dir, 'tmp-')), outputDir: dir,
    options: {}, signal: new AbortController().signal, progress() {}, qpdf,
  };
}

const realQpdf = (args, opts = {}) => runProcess(
  binaryPath('qpdf.exe', { appRoot: APP_ROOT, isPackaged: false, resourcesPath: '' }),
  args, opts,
);

test('ghép 3 file, giữ thứ tự trang', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsp-merge-'));
  const a = path.join(dir, 'a.pdf'), b = path.join(dir, 'b.pdf'), c = path.join(dir, 'c.pdf');
  await makePdf(a, [101, 102]);
  await makePdf(b, [103]);
  await makePdf(c, [104, 105]);
  const ctx = await makeCtx([a, b, c], dir);
  const result = await merge(ctx);
  const out = result.outputs[0].path;
  assert.match(path.basename(out), /^a-ghep\.pdf$/);
  const doc = await PDFDocument.load(fs.readFileSync(out));
  assert.deepEqual(doc.getPages().map(p => Math.round(p.getWidth())), [101, 102, 103, 104, 105]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('fallback pdf-lib khi qpdf lỗi', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsp-merge-'));
  const a = path.join(dir, 'a.pdf'), b = path.join(dir, 'b.pdf');
  await makePdf(a, [201]); await makePdf(b, [202]);
  const ctx = await makeCtx([a, b], dir, async () => { throw new Error('qpdf không chạy được'); });
  const result = await merge(ctx);
  const doc = await PDFDocument.load(fs.readFileSync(result.outputs[0].path));
  assert.equal(doc.getPageCount(), 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('PDF cần mật khẩu báo PASSWORD_REQUIRED', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsp-merge-'));
  const a = path.join(dir, 'a.pdf');
  await makePdf(a, [100]);
  const ctx = await makeCtx([a, a], dir, async () => {
    throw Object.assign(new Error('invalid password'), { stderr: 'invalid password', code: 'PROCESS_FAILED' });
  });
  await assert.rejects(merge(ctx), e => e instanceof ToolError && e.code === 'PASSWORD_REQUIRED');
  fs.rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Chạy test để thấy fail**

Run: `cd app && npm run test:tools`
Expected: FAIL vì `suite/pdfops/organize.js` chưa có.

- [ ] **Step 3: Cài đặt merge**

Tạo `app/suite/pdfops/organize.js`:

```js
const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument } = require('pdf-lib');
const { ToolError } = require('../errors');
const { moveAtomic, outputName, uniquePath } = require('../util/paths');

async function merge(ctx) {
  const { files, tempDir, signal } = ctx;
  if (files.length < 2) throw new ToolError('INVALID_FILE', 'Cần ít nhất 2 file PDF.');
  ctx.progress('processing', 0, 1, 'Đang ghép PDF…');
  const outDir = ctx.outputDir || path.dirname(files[0]);
  fs.mkdirSync(outDir, { recursive: true });
  const out = uniquePath(outDir, outputName(files[0], 'ghep'));
  const tmp = path.join(tempDir, 'merged.pdf');

  try {
    const args = ['--empty', '--pages', ...files.flatMap(f => [f, '1-z']), '--', tmp];
    await ctx.qpdf(args);
  } catch (e) {
    if (e.code === 'CANCELLED') throw e;
    const text = `${e.stderr || ''} ${e.message || ''}`;
    if (/password|encrypted/i.test(text)) {
      throw new ToolError('PASSWORD_REQUIRED', 'Một file PDF có mật khẩu. Hãy mở khoá trước.');
    }
    await mergeWithPdfLib(files, tmp, signal);
  }

  signal.throwIfAborted();
  moveAtomic(tmp, out);
  ctx.progress('done', 1, 1, 'Đã ghép xong');
  const doc = await PDFDocument.load(fs.readFileSync(out));
  return { outputs: [{ path: out }], errors: [], stats: { pages: doc.getPageCount() } };
}

async function mergeWithPdfLib(files, out, signal) {
  const doc = await PDFDocument.create();
  for (const f of files) {
    signal.throwIfAborted();
    let src;
    try {
      src = await PDFDocument.load(fs.readFileSync(f));
    } catch (e) {
      if (/encrypt/i.test(e.message)) {
        throw new ToolError('PASSWORD_REQUIRED', 'Một file PDF có mật khẩu. Hãy mở khoá trước.');
      }
      throw new ToolError('CORRUPT_FILE', `Không đọc được ${path.basename(f)}.`);
    }
    const pages = await doc.copyPages(src, src.getPageIndices());
    pages.forEach(p => doc.addPage(p));
  }
  fs.writeFileSync(out, await doc.save());
}

module.exports = { merge };
```

- [ ] **Step 4: Gắn runner vào registry và job IPC**

Trong `app/suite/registry.js`, require và gắn run cho merge:

```js
const { merge } = require('./pdfops/organize');
```

Sửa dòng `merge` trong `TOOLS` thêm `run: merge`.

Trong `app/main.js`, `JobRunner` đã được `require` ở đầu file (Task 5). Đặt khối runner + IPC **trước** `createWindow()` để handler sẵn sàng trước khi renderer gọi:

```js
const logFile = path.join(app.getPath('userData'), 'logs', 'tools.log');
const log = createLogger(logFile);
const runner = new JobRunner({
  tools: getTools(),
  qpdfPath: binaryPath('qpdf.exe', {
    appRoot: __dirname, isPackaged: app.isPackaged, resourcesPath: process.resourcesPath,
  }),
  tempRoot: path.join(app.getPath('temp'), 'TrinhSuaPDF', 'jobs'),
  log,
  onEvent: ev => { if (win && !win.isDestroyed()) win.webContents.send('suite:job-event', ev); },
});
ipcMain.handle('suite:job-start', (_e, req) => {
  try {
    return { ok: true, jobId: runner.start(req) };
  } catch (e) {
    log(`job-start rejected: ${e.stack || e.message}`);
    return { ok: false, error: toPayload(e) };
  }
});
ipcMain.handle('suite:job-cancel', (_e, { jobId } = {}) => runner.cancel(jobId));
```

Thêm `const { toPayload } = require('./suite/errors');` vào đầu `main.js` (cùng nhóm require ở Task 5).

- [ ] **Step 5: Mở API job trong preload**

Thêm vào `api.suite`:

```js
jobStart: req => ipcRenderer.invoke('suite:job-start', req),
jobCancel: jobId => ipcRenderer.invoke('suite:job-cancel', { jobId }),
onJobEvent: cb => ipcRenderer.on('suite:job-event', (_e, ev) => cb(ev)),
```

- [ ] **Step 6: Thêm E2E merge**

Thêm vào `app/test/suite-e2e.mjs` trước `closeApp` (dùng `fs`, `path`, `OUT` đã import ở Task 6):

```js
// Quay về home sau khi test editor ở Task 6
await w.click('#homeBtn');
await w.waitForFunction(() => window.__suite?.tools().length === 14, null, { timeout: 30000 });

const a = path.join(OUT, 'm1a-a.pdf'), b = path.join(OUT, 'm1a-b.pdf'), outDir = path.join(OUT, 'm1a-out');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const { PDFDocument } = require('pdf-lib');
async function make(file, n) {
  const d = await PDFDocument.create();
  for (let i = 0; i < n; i++) d.addPage([100 + i, 200]);
  fs.writeFileSync(file, await d.save());
}
await make(a, 2); await make(b, 3);

await w.evaluate(() => window.__suite.openTool('merge'));
await w.waitForFunction(() => window.__suite.state.tool?.id === 'merge');
await w.evaluate(({ files, out }) => {
  window.__suite.addFiles(files); window.__suite.setOutputDir(out);
}, { files: [a, b], out: outDir });
await w.click('#runBtn');
const res = await w.evaluate(() => window.__suite.waitJob(30000));
console.log('merge result:', JSON.stringify(res));
if (!res?.outputs?.length) throw new Error('Merge không tạo output');
const outFile = res.outputs[0].path;
const merged = await PDFDocument.load(fs.readFileSync(outFile));
if (merged.getPageCount() !== 5) throw new Error('Sai số trang: ' + merged.getPageCount());
console.log('merge ok:', outFile);
```

- [ ] **Step 7: Chạy test**

```bash
cd app
npm run test:tools
npm run test:suite
```

Expected: PASS; output `m1a-out/m1a-a-ghep.pdf` 5 trang.

- [ ] **Step 8: Commit**

```bash
git add app/suite/pdfops/organize.js app/suite/registry.js app/main.js app/preload.js app/test/suite-unit/merge.test.mjs app/test/suite-e2e.mjs
git commit -m "M1a: công cụ ghép PDF chạy end-to-end qua job queue"
```

---

## Task 8: Hồi quy, giấy phép và cấu hình đóng gói

**Files:**
- Modify: `app/package.json`, `app/THIRD-PARTY-NOTICES.txt`
- Test: chạy toàn bộ

**Interfaces:**
- Produces: qpdf nằm trong `extraResources` khi build; ghi công qpdf; xác nhận toàn bộ test cũ + mới xanh.

- [ ] **Step 1: Thêm extraResources và suite vào gói**

Trong `app/package.json` mục `build`, thêm:

```json
"extraResources": [
  { "from": "bin", "to": "bin" }
],
```

Sửa mảng `files` để có `"suite/**/*"` (nếu thiếu, bản đóng gói sẽ không require được `suite/registry` và app crash) và `"THIRD-PARTY-NOTICES.txt"`:

```json
"files": [
  "main.js",
  "preload.js",
  "suite/**/*",
  "renderer/**/*",
  "build/icon.png",
  "THIRD-PARTY-NOTICES.txt",
  "licenses/**/*",
  "!test/**",
  "!dist/**"
]
```

- [ ] **Step 2: Viết giấy phép qpdf**

Tải toàn văn giấy phép Apache 2.0:

```bash
cd app
mkdir -p licenses
curl -fsSL https://www.apache.org/licenses/LICENSE-2.0.txt -o licenses/Apache-2.0.txt
```

Tạo `app/THIRD-PARTY-NOTICES.txt`:

```text
qpdf 12.4.2
Copyright (c) 2005-2025 Jay Berkenbilt and contributors
License: Apache License 2.0 — toàn văn tại licenses/Apache-2.0.txt
Source: https://github.com/qpdf/qpdf
Binary: qpdf-12.4.2-mingw64_x64.zip
SHA-256: 773D2FA0C7D161E2271430734338E560A07B25D0EDF11CEEE8E53DE435012766

pdf-lib 1.17.1
License: MIT — https://github.com/Hopding/pdf-lib
```

- [ ] **Step 3: Chạy toàn bộ test**

```bash
cd app
npm run test:tools
npm run test:suite
npm test
npm run test:e2e
npm run test:overlay
npm run test:signature
npm run test:erase
npm run test:editing
npm run test:session
npm run test:rotation
```

Expected: tất cả PASS, bao gồm 8 bộ editor cũ không sửa selector.

- [ ] **Step 4: Kiểm tra build có qpdf**

Run: `cd app && npm run build`
Expected: build thành công; kiểm tra `dist/win-unpacked/resources/bin/win32-x64/qpdf.exe` tồn tại và chạy `--version`.

- [ ] **Step 5: Commit**

```bash
git add app/package.json app/package-lock.json app/THIRD-PARTY-NOTICES.txt app/licenses
git commit -m "M1a: đóng gói qpdf trong extraResources và ghi giấy phép"
```

---

## Self-review (theo spec)

- **Giữ editor:** Task 4 chỉ đổi entry + thêm nút; Task 8 chạy lại 8 bộ test cũ, không sửa selector.
- **Shell home/tool:** Task 6; design token dùng chung; editor redesign để M3 đúng lộ trình đã duyệt.
- **14 công cụ:** registry Task 5 hiển thị đủ; M1a chỉ mở `merge`; `pdf-images`/`protect` mở ở M1b.
- **Engine/job:** Task 3 + 7; queue, progress, cancel, temp, atomic move; `suite:job-start` trả `{ok, jobId}` hoặc `{ok:false, error:{code,message}}` để UI không hiện lỗi kỹ thuật của Electron IPC.
- **Module system:** engine CommonJS `.js` để `require` ổn định trong asar; test `.mjs` dùng `createRequire`; không có import ESM trong main/engine.
- **qpdf:** Task 1 + 7 + 8; version/SHA cố định.
- **Bảo mật:** spawn không shell; file paths qua IPC; chưa có công cụ mật khẩu ở M1a.
- **Kiểm thử:** unit cho parser/schema/paths/jobs/spawn/log/merge; E2E home + editor + merge; regression 8 bộ.
- **Ngoài phạm vi M1a (đã có kế hoạch riêng):** render worker, PDF → ảnh, khoá PDF, 11 công cụ còn lại, file gần đây + Cài đặt nhẹ, redesign editor, đóng gói cuối.

## Execution Handoff

Plan hoàn tất và lưu tại `docs/superpowers/plans/2026-10-28-suite-m1a-foundation-merge.md`. Hai cách thực thi:

1. **Subagent-Driven (khuyến nghị)** — mỗi task một subagent mới, tôi review giữa các task.
2. **Inline Execution** — chạy tuần tự trong phiên này, có checkpoint.

Chọn cách nào?
