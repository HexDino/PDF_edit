# M3 — Thiết kế lại giao diện Trình sửa PDF — Kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chuyển editor sang bố cục canvas-first (top bar 56 px · rail công cụ 72 px · thumbnail thu gọn · inspector phải 320 px) mà **không đổi bất kỳ hành vi nào** và giữ nguyên 100% hợp đồng DOM của app.js + 8 bộ test cũ.

**Architecture:** Chỉ thay markup `editor.html` và CSS `styles.css`; `app.js` chỉ nhận 3 hook trình bày (guard `pointerdown` sang `#chrome`, cập nhật `#fileTitle`/body class dirty, 2 handler thu gọn panel). Các khối `.ctx .sec[data-ctx]` được di chuyển nguyên vẹn vào inspector để app.js tiếp tục bật/tắt `.show`.

**Tech Stack:** Electron 33, HTML/CSS thuần, JavaScript ES module (renderer), Playwright core, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-30-m3-editor-ui-design.md` (đọc trước; chứa hợp đồng DOM đầy đủ, wireframe và tiêu chí nghiệm thu).

## Global Constraints

- Giữ nguyên **mọi** ID/class/selector liệt kê ở spec §2; không sửa selector trong 8 bộ test cũ.
- Chỉ sửa `app.js` đúng 3 nhóm hook + việc giữ class body trong `setTool()` ở spec §7; không đổi object model, render PDF.js, export, font subset, chữ ký, phiên, undo/redo, zoom math, phím tắt.
- Không thêm dependency; offline; tiếng Việt; cửa sổ tối thiểu 900×600; chữ ≥12 px; vùng bấm ≥32 px.
- Giữ `<header>` (app.js), `#wrap`, `#side`, `#thumbs`, `#viewer`, `#pages`, `#empty`, `.ctx .sec[data-ctx]`, body class `tool-*`.
- Sau **mỗi** task: `npm test`, `npm run test:e2e`, `test:overlay`, `test:signature`, `test:erase`, `test:editing`, `test:session`, `test:rotation`, `test:fonts` phải xanh. Task chạm phần dùng chung còn phải chạy `test:tools` + `test:suite`.
- Không commit gì khi test đỏ; mỗi task một commit trên nhánh `feature/m3-editor-ui` (worktree riêng).
- Ảnh nghiệm thu: 1400×900 và 900×600, không cuộn ngang, canvas ≥520 px.

---

## File Structure

- Modify: `app/renderer/editor.html` — top bar, rail, workspace (`#wrap`), inspector chứa `.ctx`, hint bar; giữ nguyên các modal/input ẩn phía dưới.
- Rewrite: `app/renderer/styles.css` — token/layout/component; giữ selector app.js dùng.
- Modify: `app/renderer/app.js` — chỉ 3 nhóm hook (xem Task 1).
- Create: `app/test/editor-dom-contract.mjs` — kiểm tra hợp đồng DOM (ID/class bắt buộc) trên app thật.
- Không sửa: `suite.js`, `suite.css` (trừ khi thêm biến token dùng chung, không bắt buộc), engine `suite/`, các test cũ.

---

### Task 1: Khung shell + token + hợp đồng DOM

**Files:**
- Modify: `app/renderer/editor.html` (toàn bộ phần đầu tới trước modal chữ ký)
- Modify: `app/renderer/styles.css` (khối layout đầu file + override component)
- Modify: `app/renderer/app.js:85-89, 201-204, 371`
- Test: `app/test/editor-dom-contract.mjs` (mới)

**Interfaces:**
- Produces: `#chrome` (guard vùng chrome), `#fileTitle`, `#thumbsToggle`, `#inspectorToggle`, `#inspectorClose`, body class `dirty`, `thumbs-collapsed`, `thumbs-open`, `inspector-open`.
- Consumes: toàn bộ ID/class hiện có trong `editor.html` (không đổi tên).

- [ ] **Step 1: Viết test hợp đồng DOM (đỏ trước)**

Tạo `app/test/editor-dom-contract.mjs`:

```js
import { _electron as electron } from 'playwright-core';
import path from 'path';
import { APP_ROOT, electronBin, testFile, electronEnv, closeApp } from './_paths.mjs';

const REQUIRED_IDS = [
  'homeBtn','openBtn','saveBtn','saveAsBtn','saveSessionBtn','clearSessionBtn',
  'zoomIn','zoomOut','zoomFit','zoomLbl','sigBtn','imgBtn','undoBtn','redoBtn','delBtn',
  'dot','status','sessionTag','fontBtn','fontBtnTxt','fontPanel','fontSearch','fontPreviewText',
  'fontList','sizeIn','slantIn','jitterIn','colorIn','penW','rotIn','recolorBtn','snapLines',
  'brushW','fillModeIn','featherIn','fillIn','autoFillBtn','pickBtn','autoFillIn',
  'side','thumbs','viewer','empty','heroHand','openBtn2','pages',
  'sigModal','pad','padW','padUndo','padClear','sigImgBtn','sigImgCanvas','sigImgEmpty',
  'bgRemove','bgTol','bgAutoBtn','sigRecolor','sigRecolorC','sigCrop','sigWeight','libGrid',
  'sigAtBL','sigAtBC','sigAtBR','sigAllPages','saveLibWrap','saveLib','keepPadWrap','keepPad','sigUse',
  'saveModal','saveInfo','trueRemove','flatOpts','flatFormat','flatDpi','flatQuality',
  'flatQualityLbl','flatHint','saveGo','fileInput','imgInput','sigImgInput','measure','toast','busy','busyTxt',
];
const REQUIRED_SELECTORS = [
  'header', '#wrap', '#chrome', '#rail', '#inspector', '#fileTitle',
  '.ctx .sec[data-ctx]', '.ctx .sec.show', '[data-tool]', '[data-es]', '.tabs [data-tab]',
  '.th', '.page', '.layer', '#fontList .fi',
];

const app = await electron.launch({
  executablePath: electronBin,
  args: [APP_ROOT, '--no-sandbox', testFile('scan-test.pdf')],
  env: electronEnv,
});
try {
  const w = await app.firstWindow();
  await w.waitForFunction(() => window.__app && window.__app.pages.length > 0, null, { timeout: 60000 });
  const missingIds = await w.evaluate(ids => ids.filter(id => !document.getElementById(id)), REQUIRED_IDS);
  const missingSelectors = await w.evaluate(sels => sels.filter(s => !document.querySelector(s)), REQUIRED_SELECTORS);
  const toolCount = await w.evaluate(() => document.querySelectorAll('[data-tool]').length);
  const secCount = await w.evaluate(() => document.querySelectorAll('.ctx .sec[data-ctx]').length);
  if (missingIds.length) throw new Error('Missing IDs: ' + missingIds.join(', '));
  if (missingSelectors.length) throw new Error('Missing selectors: ' + missingSelectors.join(', '));
  if (toolCount !== 5) throw new Error('Expected 5 [data-tool], got ' + toolCount);
  if (secCount !== 7) throw new Error('Expected 7 .ctx .sec, got ' + secCount);
  await w.click('[data-tool="erase"]');
  if (await w.evaluate(() => document.body.className) !== 'tool-erase') throw new Error('tool class not switched');
  console.log('editor DOM contract ok · 5 tools · 7 property sections');
} finally {
  await closeApp(app);
}
```

- [ ] **Step 2: Chạy test để thấy đỏ**

Run: `cd app && node test/editor-dom-contract.mjs`
Expected: FAIL `Missing IDs: fileTitle, ...` (và `#chrome`, `#rail`, `#inspector`).

- [ ] **Step 3: Dựng lại markup `editor.html`**

Thay toàn bộ từ `<body>` đến hết khối `<div id="wrap">…</div>` bằng cấu trúc dưới. **Giữ nguyên từng nút/input và ID**; chỉ đổi vị trí. Các khối `.ctx .sec` copy nguyên văn từ `editor.html` cũ **dòng 45–101** vào `#inspector .ctx` (7 section, giữ `data-ctx`); empty state copy **dòng 106–114**; modal **dòng 119–213** giữ nguyên.

```html
<body class="tool-text">
<div id="chrome">
  <header class="topbar">
    <button id="homeBtn" class="iconBtn" title="Về trang chủ" aria-label="Về trang chủ">←</button>
    <div class="fileMeta">
      <span id="fileTitle" class="fileName">Chưa mở file</span>
      <span class="fileSub"><span class="dot ok" id="dot"></span><span id="status">Sẵn sàng</span><span id="sessionTag" hidden></span></span>
    </div>
    <div class="grow"></div>
    <div class="grp">
      <button id="openBtn" class="btn" title="Mở file PDF (Ctrl+O)">📂 <span class="lbl">Mở</span></button>
      <button id="undoBtn" class="iconBtn" title="Hoàn tác (Ctrl+Z)" aria-label="Hoàn tác">↶</button>
      <button id="redoBtn" class="iconBtn" title="Làm lại (Ctrl+Y)" aria-label="Làm lại">↷</button>
      <button id="delBtn" class="iconBtn" title="Xoá đối tượng đang chọn (Delete)" aria-label="Xoá đối tượng" disabled>🗑</button>
    </div>
    <div class="grp">
      <button id="saveBtn" class="btn primary" title="Lưu (Ctrl+S)" disabled>💾 <span class="lbl">Lưu</span></button>
      <button id="saveAsBtn" class="btn" title="Lưu thành file khác (Ctrl+Shift+S)" disabled><span class="lbl">Lưu thành…</span></button>
      <details class="menu">
        <summary class="btn ghost"><span class="lbl">Tệp</span> ▾</summary>
        <div class="pop">
          <button id="saveSessionBtn" disabled>🗂 Lưu phiên</button>
          <button id="clearSessionBtn" disabled>Xoá phiên</button>
        </div>
      </details>
    </div>
    <div class="grp zoom">
      <button id="zoomOut" class="iconBtn" title="Thu nhỏ (Ctrl −)">−</button>
      <span id="zoomLbl">100%</span>
      <button id="zoomIn" class="iconBtn" title="Phóng to (Ctrl +)">+</button>
      <button id="zoomFit" class="iconBtn" title="Vừa chiều rộng">↔</button>
    </div>
    <button id="inspectorToggle" class="iconBtn" title="Thuộc tính" aria-label="Mở thuộc tính">☰</button>
  </header>

  <div id="wrap">
    <nav id="rail" aria-label="Công cụ">
      <button class="tool" data-tool="select" title="Chọn / di chuyển (V)">↖<span>Chọn</span></button>
      <button class="tool on" data-tool="text" title="Thêm chữ viết tay (T)">✎<span>Chữ</span></button>
      <button class="tool" data-tool="erase" title="Tẩy xóa (E)">▭<span>Tẩy xoá</span></button>
      <button class="tool" id="sigBtn" title="Chữ ký">✍<span>Chữ ký</span></button>
      <button class="tool" id="imgBtn" title="Chèn ảnh">🖼<span>Ảnh</span></button>
      <button class="tool" data-tool="pen" title="Bút vẽ (P)">🖊<span>Bút</span></button>
      <button class="tool" data-tool="hl" title="Bút dạ quang (H)">🖍<span>Dạ quang</span></button>
      <span class="grow"></span>
      <button id="thumbsToggle" class="iconBtn" title="Ẩn/hiện trang" aria-label="Ẩn/hiện trang">▤</button>
    </nav>

    <aside id="side">
      <div class="sideHead">Trang</div>
      <div id="thumbs"></div>
    </aside>

    <main id="viewer">
      <div id="empty"> …giữ nguyên nội dung empty state cũ, gồm #heroHand và #openBtn2… </div>
      <div id="pages" hidden></div>
    </main>

    <aside id="inspector" aria-label="Thuộc tính">
      <div class="inspHead"><b>Thuộc tính</b><button id="inspectorClose" class="iconBtn" title="Đóng">✕</button></div>
      <div class="ctx">
        …copy nguyên 7 khối .sec[data-ctx] từ editor.html cũ (font, màu, nét, xoay, kiểu xoá, nền che, hint)…
      </div>
    </aside>
  </div>

  <div class="hintBar">Kéo để di chuyển · Delete để xoá · Ctrl+Z hoàn tác · Ctrl+S lưu</div>
</div>
<!-- giữ nguyên toàn bộ modal chữ ký, modal lưu, input file, #measure, #toast, #busy, script -->
```

- [ ] **Step 4: CSS layout mới (đầu `styles.css`)**

Thay khối layout cũ (`header`, `.bar`, `.ctx`, `#wrap`, `#side`, `main`, `#pages`) bằng:

```css
:root{--topbar:56px;--rail:72px;--thumbs:168px;--inspector:320px;--hint:30px}
body{display:flex;flex-direction:column;height:100%;overflow:hidden;user-select:none}
#chrome{flex:1;display:flex;flex-direction:column;min-height:0}
.topbar{height:var(--topbar);background:#fff;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:8px;padding:0 12px;z-index:20}
.fileMeta{display:flex;flex-direction:column;gap:2px;min-width:180px;max-width:260px}
.fileName{font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fileSub{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--mut);white-space:nowrap}
body.dirty .fileSub .dot{background:#f59e0b}
.grow{flex:1}
.grp{display:flex;align-items:center;gap:5px;padding:0 6px;border-left:1px solid var(--line)}
#wrap{flex:1;display:flex;min-height:0;position:relative}
#rail{width:var(--rail);background:#f8fafd;border-right:1px solid var(--line);display:flex;flex-direction:column;align-items:center;gap:4px;padding:10px 0;flex:none}
#rail .tool{width:56px;height:52px;border:0;background:transparent;border-radius:10px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;font:inherit;color:#475569;cursor:pointer}
#rail .tool span{font-size:12px;color:#64748b}
#rail .tool.on{background:#e6efff;color:var(--blue-d)}
#rail .tool.on span{color:var(--blue-d);font-weight:600}
#side{width:var(--thumbs);background:#f5f8fc;border-right:1px solid var(--line);overflow:auto;flex:none;transition:width .14s ease}
#viewer{flex:1;overflow:auto;position:relative}
#inspector{width:var(--inspector);background:#fff;border-left:1px solid var(--line);display:flex;flex-direction:column;flex:none;z-index:10}
.inspHead{height:52px;display:flex;align-items:center;gap:8px;padding:0 12px;border-bottom:1px solid var(--line)}
/* Task 1: chưa đặt overflow để #fontPanel tuyệt đối không bị cắt; Task 3 sẽ chuyển panel sang fixed rồi mới cho scroll. */
.ctx{flex:1;overflow:visible;display:flex;flex-direction:column;gap:10px;padding:12px;background:#fff}
.ctx .sec{display:none;flex-direction:column;gap:8px;padding:12px;border:1px solid #e8edf4;border-radius:10px}
.ctx .sec.show{display:flex}
.hintBar{height:var(--hint);background:#fbfcfe;border-top:1px solid #eef1f5;display:flex;align-items:center;padding:0 14px;font-size:11.5px;color:var(--mut)}
body.thumbs-collapsed #side{width:0;border-right:0;overflow:hidden}
@media (max-width:1199px){
  :root{--rail:56px}
  #rail .tool span{display:none}
  #rail .tool{width:44px;height:44px}
  #side{display:none}
  body.thumbs-open #side{display:block;position:absolute;left:var(--rail);top:0;bottom:0;width:168px;z-index:25;box-shadow:12px 0 30px rgba(15,23,42,.16)}
  #inspector{position:absolute;right:0;top:0;bottom:0;width:320px;transform:translateX(100%);transition:transform .16s ease;box-shadow:-18px 0 40px rgba(15,23,42,.16)}
  body.inspector-open #inspector{transform:none}
  #inspectorToggle{display:grid}
  #inspectorClose{display:grid}
  .topbar .btn .lbl{display:none}
}
@media (min-width:1200px){#inspectorToggle,#inspectorClose{display:none}}
```

Giữ nguyên các khối CSS còn lại (font panel, object, modal) và sửa `#fontPanel` thành flyout trái inspector ở Task 3.

- [ ] **Step 5: Hook app.js (3 điểm)**

```js
// 1) setDirty: thêm class body để CSS đổi chấm dirty
function setDirty(d) {
  dirty = d; API?.setDirty(d);
  document.body.classList.toggle('dirty', d);
  document.title = (d ? '• ' : '') + (pdfDoc ? origName + ' – ' : '') + 'Trình sửa PDF';
  if (d && origPath) sessionTag('dirty');
}
// 2) openBytes: sau khi gán origName, cập nhật tên file
$('fileTitle').textContent = origName || 'Chưa mở file';
// 3) doSave: sau `lastSavePath = where;`
$('fileTitle').textContent = where.split(/[\\/]/).pop();
// 4) pointerdown guard: thay document.querySelector('header') bằng '#chrome'
document.querySelector('#chrome').addEventListener('pointerdown', e => { if (e.target.closest('input,label,#fontPanel,select,textarea')) return; e.preventDefault(); });
// 5) toggle panel (đặt cạnh các binding nút khác)
$('thumbsToggle').onclick = () => {
  const narrow = matchMedia('(max-width:1199px)').matches;
  document.body.classList.toggle(narrow ? 'thumbs-open' : 'thumbs-collapsed');
};
$('inspectorToggle').onclick = () => document.body.classList.toggle('inspector-open');
$('inspectorClose').onclick = () => document.body.classList.remove('inspector-open');
```

- [ ] **Step 6: Chạy test hợp đồng + 8 bộ test**

Run: `cd app && node test/editor-dom-contract.mjs && npm test && npm run test:e2e && npm run test:overlay && npm run test:signature && npm run test:erase && npm run test:editing && npm run test:session && npm run test:rotation && npm run test:fonts`
Expected: tất cả PASS.

- [ ] **Step 7: Commit**

```bash
git add app/renderer/editor.html app/renderer/styles.css app/renderer/app.js app/test/editor-dom-contract.mjs
git commit -m "M3: khung editor canvas-first và hợp đồng DOM"
```

---

### Task 2: Top bar, rail và menu Tệp

**Files:**
- Modify: `app/renderer/editor.html` (top bar/rail)
- Modify: `app/renderer/styles.css` (top bar/rail/menu)
- Modify: `app/renderer/app.js` (`setTool()` giữ body class)
- Test: chạy `test/e2e.mjs`, `test/editing.mjs`, `test/session.mjs`

**Interfaces:**
- Consumes: `#fileTitle`, body `dirty` từ Task 1.
- Produces: menu `<details class="menu">` với `#saveSessionBtn`/`#clearSessionBtn`; rail `[data-tool]` + `#sigBtn`/`#imgBtn`; body class `dirty`/drawer sống sót khi đổi công cụ.

- [ ] **Step 0: Giữ body class khi đổi công cụ + test**

Sửa `setTool()` trong `app.js`:

```js
function setTool(t) {
  if (t !== 'pick') prevTool = t;
  tool = t;
  const keep = [...document.body.classList].filter(c => !c.startsWith('tool-'));
  document.body.className = [...keep, 'tool-' + t].join(' ');
  document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  if (t !== 'place') pendingPlace = null;
  syncControls();
}
```

Thêm test vào `test/editing.mjs` (trước phần tổng kết):

```js
await A(() => document.body.classList.add('dirty', 'inspector-open'));
await w.click('[data-tool="pen"]');
const kept = await A(() => ({ cls: document.body.className, dirty: document.body.classList.contains('dirty'), drawer: document.body.classList.contains('inspector-open') }));
if (!kept.dirty || !kept.drawer || !/\btool-pen\b/.test(kept.cls)) throw new Error('setTool làm mất class body: ' + kept.cls);
await A(() => document.body.classList.remove('dirty', 'inspector-open'));
console.log('setTool giữ body class ok:', kept.cls);
```

Run: `cd app && node test/editing.mjs` → đỏ trước khi sửa (`setTool làm mất class body`), xanh sau khi sửa.

- [ ] **Step 1: Viết kiểm tra UI (đỏ nếu thiếu hành vi)**

Thêm vào cuối `test/editing.mjs` một bước kiểm tra DOM/trạng thái (dùng app đang mở):

```js
const ui = await A(() => ({
  railTools: [...document.querySelectorAll('#rail [data-tool]')].map(b => b.dataset.tool),
  saveInMenu: !!document.querySelector('.menu #saveSessionBtn'),
  title: document.getElementById('fileTitle').textContent,
  dirtyClass: document.body.classList.contains('dirty'),
}));
if (ui.railTools.join(',') !== 'select,text,erase,pen,hl') throw new Error('Rail tools sai: ' + ui.railTools);
if (!ui.saveInMenu) throw new Error('Thiếu Lưu phiên trong menu Tệp');
if (!ui.title) throw new Error('Thiếu tên file ở top bar');
console.log('top bar/rail ok:', JSON.stringify(ui));
```

- [ ] **Step 2: Chạy test để thấy đỏ**

Run: `cd app && node test/editing.mjs`
Expected: FAIL `Rail tools sai` (Task 1 đã đặt data-tool trong rail; nếu đã đúng, test này xanh — khi đó thêm kiểm tra `document.querySelector('.menu #saveSessionBtn')` trước khi hoàn thiện markup).

- [ ] **Step 3: Hoàn thiện top bar/rail**

- Icon SVG một nét cho Mở/Undo/Redo/Xoá/Lưu/Lưu thành/Zoom/Fit; giữ text trong `<span class="lbl">` để 900 px ẩn nhãn.
- Menu `<details class="menu">` với `#saveSessionBtn`, `#clearSessionBtn`; đóng menu khi bấm một mục:
  ```js
  document.querySelectorAll('.menu .pop button').forEach(b => b.addEventListener('click', () => b.closest('details').removeAttribute('open')));
  ```
- Rail: nhãn 12 px (`#rail .tool span{font-size:12px}`); icon 19 px; active có vạch trái như mockup; ở 900 px ẩn nhãn, chỉ icon + tooltip.
- Top bar: `.fileMeta` hiển thị `#fileTitle` + `#status` + `#sessionTag`; `#dot` màu theo `status()`; body.dirty đổi chấm cam.
- 900 px: ẩn `.lbl` của nút phụ, giữ `title`/`aria-label`.

- [ ] **Step 4: Chạy lại 3 bộ test + chụp ảnh**

Run: `cd app && node test/editing.mjs && npm run test:e2e && npm run test:session`
Expected: PASS. Chụp screenshot 1400×900 vào `docs/m3-editor-topbar.png`.

- [ ] **Step 5: Commit**

```bash
git add app/renderer/editor.html app/renderer/styles.css app/test/editing.mjs docs/m3-editor-topbar.png
git commit -m "M3: top bar, rail công cụ và menu Tệp"
```

---

### Task 3: Inspector thuộc tính + font flyout

**Files:**
- Modify: `app/renderer/editor.html` (`.ctx` sections giữ ID)
- Modify: `app/renderer/styles.css` (`.ctx`, `#fontPanel`)
- Test: `test/e2e.mjs`, `test/erase.mjs`, `test/fonts-export.mjs`

**Interfaces:**
- Consumes: `.ctx .sec[data-ctx]` (app.js toggles `.show`).
- Produces: `.ctx` dạng card dọc; `#fontPanel` flyout 380 px ở ≥1200, modal ở <1200.

- [ ] **Step 1: Thêm kiểm tra inspector**

Trong `test/e2e.mjs`, sau khi mở editor và chọn công cụ erase, thêm:

```js
await w.click('[data-tool="erase"]');
const visible = await w.evaluate(() => [...document.querySelectorAll('.ctx .sec')].filter(s => s.classList.contains('show')).map(s => s.dataset.ctx));
if (!visible.includes('erase rect')) throw new Error('Inspector không hiện nhóm tẩy xoá: ' + visible);
const rect = await w.evaluate(() => { const s = document.querySelector('.ctx'); const r = s.getBoundingClientRect(); return { w: r.width, top: r.top }; });
if (rect.w < 260) throw new Error('Inspector quá hẹp: ' + rect.w);
console.log('inspector ok:', JSON.stringify({ visible, width: rect.w }));
```

- [ ] **Step 2: Chạy để thấy đỏ**

Run: `cd app && npm run test:e2e`
Expected: FAIL `Inspector không hiện nhóm tẩy xoá` hoặc `Inspector quá hẹp` (trước khi CSS đổi).

- [ ] **Step 3: CSS inspector + font flyout**

```css
.ctx .sec h4{margin:0 0 2px;font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:var(--mut);font-weight:700}
.ctx .sec .row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0}
.ctx .sec .lbl{font-size:12px}
.ctx .sec .warn{max-width:none}
#fontBtn{min-width:0;width:100%;justify-content:space-between;font-size:17px;height:46px}
/* fixed để không bị .ctx (scroll) cắt; đặt ngay bên trái inspector */
#fontPanel{position:fixed;left:auto;right:calc(var(--inspector) + 16px);top:108px;width:380px;max-height:70vh;z-index:60}
.ctx{overflow-y:auto}
@media (max-width:1199px){
  #fontPanel{left:50%;top:50%;right:auto;transform:translate(-50%,-50%);width:min(520px,92vw);z-index:90}
}
```

- [ ] **Step 4: Chia section thành card có tiêu đề**

Trong mỗi `.sec`, thêm `<h4>` tiêu đề: “Phông chữ”, “Màu mực”, “Độ dày nét”, “Xoay ảnh”, “Kiểu xoá”, “Nền che”, “Chọn đối tượng”. Không đổi input/ID.

- [ ] **Step 5: Chạy test + kiểm tra font panel**

Run: `cd app && npm run test:e2e && npm run test:erase && npm run test:fonts`
Expected: PASS; mở picker phông hiển thị flyout không tràn inspector.

- [ ] **Step 6: Commit**

```bash
git add app/renderer/editor.html app/renderer/styles.css app/test/e2e.mjs
git commit -m "M3: inspector thuộc tính và font flyout"
```

---

### Task 4: Canvas, thumbnail thu gọn và responsive 900×600

**Files:**
- Modify: `app/renderer/styles.css` (canvas/thumbnail/object/empty)
- Modify: `app/renderer/editor.html` (page number pill, thumbnail header)
- Test: `test/overlay.mjs`, `test/erase.mjs`, `test/rotation.mjs`, `test/editing.mjs`

**Interfaces:**
- Consumes: `#side`, `#thumbs`, `#viewer`, `#pages`, body classes Task 1.
- Produces: `body.thumbs-collapsed`/`thumbs-open` hoạt động; `#empty` card mới; page pill.

- [ ] **Step 1: Test responsive**

Thêm vào `test/editing.mjs`:

```js
await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.unmaximize(); win.setSize(900, 600); });
await w.waitForTimeout(300);
const compact = await w.evaluate(() => ({
  overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  rail: document.querySelector('#rail').getBoundingClientRect().width,
  viewer: document.querySelector('#viewer').getBoundingClientRect().width,
  inspectorVisible: document.querySelector('#inspector').getBoundingClientRect().right <= window.innerWidth + 1 && document.querySelector('#inspector').getBoundingClientRect().left < window.innerWidth,
}));
if (compact.overflow) throw new Error('Canvas bị cuộn ngang ở 900x600');
if (compact.viewer < 500) throw new Error('Canvas quá hẹp: ' + compact.viewer);
if (compact.inspectorVisible) throw new Error('Inspector phải là drawer đóng ở 900x600');
console.log('responsive 900x600 ok:', JSON.stringify(compact));
```

- [ ] **Step 2: Chạy để thấy đỏ** — `cd app && node test/editing.mjs` → FAIL (inspector còn chiếm chỗ / tràn ngang).

- [ ] **Step 3: CSS canvas/thumbnail/empty/object**

- `#pages` giữ gap/padding; `.page` shadow nhẹ; `.page .num` → pill `position:absolute;bottom:-20px` giữ.
- `#side` header + thumbnail 120 px; `.th.cur .paper` viền xanh; `.th .tdel` hiện hover.
- `#empty` card 520 px, viền dashed, nút primary; giữ `#heroHand`.
- Object toolbar/handles: chỉ đổi màu/kích thước, giữ class `.tools/.mv/.dup/.del/.rs/.ro`.
- Media query 1199: inspector/thumbnail drawer; `#wrap{position:relative}`; body classes.
- Ảnh 900×600: `#viewer` ≥500 px, không scroll ngang (kiểm tra bằng test Step 1).

- [ ] **Step 4: Chạy test + chụp ảnh**

Run: `cd app && node test/editing.mjs && npm run test:overlay && npm run test:erase && npm run test:rotation`
Expected: PASS. Chụp `docs/m3-editor-1400.png` và `docs/m3-editor-900.png`.

- [ ] **Step 5: Commit**

```bash
git add app/renderer/styles.css app/renderer/editor.html app/test/editing.mjs docs/m3-editor-1400.png docs/m3-editor-900.png
git commit -m "M3: canvas, thumbnail thu gọn và responsive 900x600"
```

---

### Task 5: Modal, accessibility và nghiệm thu cuối

**Files:**
- Modify: `app/renderer/styles.css` (modal/tabs/focus/reduced-motion)
- Modify: `app/renderer/editor.html` (aria-label, aria-live, tabindex nếu thiếu)
- Test: toàn bộ

- [ ] **Step 1: Kiểm tra accessibility tối thiểu**

Thêm vào `test/editor-dom-contract.mjs`:

```js
const a11y = await w.evaluate(() => ({
  statusLive: document.getElementById('status').getAttribute('aria-live'),
  toastLive: document.getElementById('toast').getAttribute('aria-live'),
  iconLabels: [...document.querySelectorAll('.iconBtn')].every(b => b.getAttribute('aria-label') || b.getAttribute('title')),
  minText: [...document.querySelectorAll('.tool span,.lbl')].every(el => parseFloat(getComputedStyle(el).fontSize) >= 12),
}));
if (a11y.statusLive !== 'polite' || a11y.toastLive !== 'polite') throw new Error('Thiếu aria-live');
if (!a11y.iconLabels) throw new Error('Icon-only thiếu aria-label/title');
if (!a11y.minText) throw new Error('Có chữ nhỏ hơn 12px');
```

- [ ] **Step 2: Chạy để thấy đỏ** — `cd app && node test/editor-dom-contract.mjs` → FAIL (thiếu aria-live/nhãn).

- [ ] **Step 3: Restyle modal + a11y**

- Modal: `.dlg` radius 14, header 56 px, `.tabs` segmented, footer sticky; giữ ID/class.
- Thêm `aria-live="polite"` cho `#status`, `#toast`; `aria-label` cho mọi `.iconBtn`; `role="dialog" aria-modal="true"` cho `.modal`.
- `@media (prefers-reduced-motion: reduce){*{transition:none!important;animation:none!important}}`.
- Focus ring 2 px `#93b4f5` cho button/input/select/[tabindex].

- [ ] **Step 4: Chạy toàn bộ pin test**

Run: `cd app && node test/editor-dom-contract.mjs && npm test && npm run test:e2e && npm run test:overlay && npm run test:signature && npm run test:erase && npm run test:editing && npm run test:session && npm run test:rotation && npm run test:fonts && npm run test:tools && npm run test:suite`
Expected: tất cả exit 0.

- [ ] **Step 5: Build và kiểm tra bản đóng gói**

Run: `cd app && npm run build`
Sau đó mở `dist/win-unpacked/TrinhSuaPDF.exe` với `test/test.pdf` (hoặc chạy `node test/smoke-asar.mjs`) để xác nhận editor render và các nút chính hoạt động.

- [ ] **Step 6: Ảnh nghiệm thu + commit**

Chụp cuối `docs/m3-editor-final-1400.png`, `docs/m3-editor-final-900.png`; đối chiếu checklist spec §9. Commit:

```bash
git add app/renderer/editor.html app/renderer/styles.css app/test/editor-dom-contract.mjs docs/m3-editor-final-1400.png docs/m3-editor-final-900.png
git commit -m "M3: hoàn thiện modal, accessibility và nghiệm thu giao diện editor"
```

---

## Verification / Acceptance

- 8 bộ test editor cũ xanh **không đổi selector**; `test/editor-dom-contract.mjs` xanh.
- Ảnh 1400×900/900×600: không cuộn ngang, canvas ≥500 px, không cắt nút; inspector là drawer ở 900.
- Tất cả chức năng editor hoạt động (checklist spec §9), phím tắt giữ nguyên.
- `test:tools` + `test:suite` xanh; build portable/NSIS thành công; mở bản đóng gói kiểm tra editor.
- Không thêm dependency; không sửa engine/suite ngoài phạm vi.

## Risks / Notes

- `#fontPanel` phải giữ class `.open` do app.js điều khiển; chỉ đổi CSS vị trí.
- `header` pointerdown guard đổi sang `#chrome` — kiểm tra giữ vùng chọn chữ khi bấm thuộc tính.
- Nếu `.ctx` chuyển ra khỏi header làm test nào phụ thuộc vị trí, cập nhật test đó trong cùng commit (không đổi selector).
- Không đổi `app.js` ngoài 3 hook; nếu buộc phải sửa thêm, ghi lý do vào commit và chạy lại toàn bộ pin test.
