# Nén PDF — Kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm công cụ thứ 14 — Nén PDF — với hai chế độ: lossless bằng qpdf (mặc định) và raster hoá trang bằng render worker + pdf-lib, kèm dung lượng trước/sau và cảnh báo mất lớp chữ.

**Architecture:** Lossless chạy qpdf `--object-streams=generate --recompress-flate --compression-level=9` trên file tạm rồi `publishUnique`. Raster dùng `ctx.render.pdfToImages` cho các trang chọn, dựng PDF mới bằng pdf-lib: trang không chọn copy nguyên, trang chọn thay bằng ảnh theo vùng hiển thị CropBox∩MediaBox và góc xoay. Registry/UI dùng schema sẵn có; renderer hiển thị dung lượng và cảnh báo `TEXT_LAYER_REMOVED`.

**Tech Stack:** Electron 33, pdf-lib 1.17.1, qpdf 12.4.2, render worker PDF.js, `node:test`, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-28-ilovepdf-suite-design.md` §6.4 (Nén PDF), §9 (lỗi), §10 (test).

## Global Constraints

- Windows x64/offline; không thêm dependency.
- Không ghi đè: ghi temp rồi `publishUnique`; đầu ra `<base>-nen.pdf`.
- PDF mã hoá → `PASSWORD_REQUIRED`; PDF hỏng → `INVALID_FILE`; lỗi khác an toàn, không lộ đường dẫn.
- Lossless mặc định; raster chỉ áp trang chọn; trang khác giữ nguyên nội dung/hộp/góc xoay.
- Chọn trang dùng `parsePageRange`; raster mặc định tất cả; lossless bỏ qua `pages`.
- Thống kê `beforeBytes`, `afterBytes`, `savedPercent`, `mode`, `rasterPages`; không hứa giảm dung lượng.
- Raster trả cảnh báo `TEXT_LAYER_REMOVED` (renderer hiển thị câu ngắn).
- 8 bộ test editor không bị sửa; chỉ thêm test mới và cập nhật test registry/E2E của bộ công cụ.
- Không sửa editor M3, không đổi version/package khi chưa có yêu cầu phát hành.

---

## File Structure

- Create: `app/suite/pdfops/compress.js` — `compressOptions`, `compressTool(ctx)`.
- Create: `app/test/suite-unit/compress.test.mjs`.
- Modify: `app/suite/registry.js` — `compress` available, options, run.
- Modify: `app/renderer/suite.js` — mapping `TEXT_LAYER_REMOVED`, dòng dung lượng trước/sau.
- Modify: `app/test/suite-unit/registry.test.mjs` — 14 available / 0 planned, options compress.
- Modify: `app/test/suite-e2e.mjs` — home 14 bật/0 tắt/0 badge; flow nén lossless + raster, warning, no-overwrite.
- Modify: `README.md` — 14 công cụ, thêm Nén PDF, bỏ “Sắp có”, ghi giới hạn lossless/raster.

---

### Task 1: Nén PDF lossless + raster

**Files:** create/modify như trên.

**Interfaces:**
- `compressTool(ctx) -> { outputs:[{path}], errors:[], stats:{beforeBytes,afterBytes,savedPercent,mode,rasterPages} }`.
- `compressOptions` dùng cho registry và test trực tiếp.

- [ ] **Step 1: Viết unit test (đỏ trước)**

Tạo `app/test/suite-unit/compress.test.mjs` với fixture pdf-lib và render giả. Các case tối thiểu:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PDFDocument } = require('pdf-lib');
const { compressTool } = require('../../suite/pdfops/compress.js');

// PNG 1×1 hợp lệ để render giả trả về
const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n0kAAAAASUVORK5CYII=', 'base64');

async function makePdf(file, pages = 3) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([200 + i * 10, 300]);
    p.drawText(`Trang ${i + 1}`, { x: 20, y: 250, size: 14 });
  }
  fs.writeFileSync(file, await doc.save());
}

function ctxFor(file, dir, overrides = {}) {
  const tempDir = fs.mkdtempSync(path.join(dir, 'tmp-'));
  return {
    files: [file], tempDir, outputDir: dir, signal: new AbortController().signal,
    options: { mode: 'lossless', pages: '', dpi: 150, format: 'png', quality: 80, ...overrides },
    progress() {}, log() {},
    qpdf: async args => {
      const { runProcess } = require('../../suite/util/spawn.js');
      const exe = path.join(process.env.TSP_APP_ROOT || path.resolve('.'), 'bin', 'win32-x64', 'qpdf.exe');
      return runProcess(exe, args, { signal: new AbortController().signal });
    },
    render: {
      pdfToImages: async ({ pages, outDir, signal }) => pages.map(n => {
        signal?.throwIfAborted?.();
        const p = path.join(outDir, `render-${n}.png`);
        fs.writeFileSync(p, PNG_1x1);
        return { page: n, path: p };
      }),
    },
  };
}
```

Test cases:

1. `lossless tạo <base>-nen.pdf, giữ số trang, báo before/after`: chạy `compressTool`; `PDFDocument.load` output; `stats.mode==='lossless'`, beforeBytes>0, afterBytes>0, `savedPercent` là số; output tên `a-nen.pdf`.
2. `lossless không ghi đè`: chạy hai lần, file thứ hai `a-nen (2).pdf`, file đầu giữ bytes.
3. `raster chỉ thay trang chọn, trang khác giữ nguyên`: `mode:'raster', pages:'2'`; output 3 trang; trang 2 có image XObject; trang 1/3 không có image; stats.rasterPages=1; errors chứa `TEXT_LAYER_REMOVED`.
4. `raster dùng vùng hiển thị CropBox và góc xoay`: fixture trang 2 CropBox [10,20,150,260], rotation 90; render giả; output page size = 140×130 (cao×rộng đổi), rotation 0.
5. `raster không ghi đè`: chạy hai lần → `(2)`.
6. `pre-abort không tạo output`; `corrupt → INVALID_FILE`; `encrypted → PASSWORD_REQUIRED` (dùng qpdf `--encrypt` như test crop).
7. `options sai` (mode lạ/dpi ngoài khoảng) → `INVALID_OPTIONS` khi gọi trực tiếp (compress tự validate qua `validateOptions` hoặc registry schema).

- [ ] **Step 2: Chạy test để thấy đỏ**

Run: `cd app && node --test test/suite-unit/compress.test.mjs`
Expected: FAIL module/`compressTool` chưa có.

- [ ] **Step 3: Viết `compress.js`**

```js
const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument } = require('pdf-lib');
const { ToolError, toPayload } = require('../errors');
const { validateOptions } = require('../schema');
const { parsePageRange } = require('../pages');
const { outputName, publishUnique } = require('../util/paths');

const compressOptions = [
  { key:'mode', type:'enum', values:['lossless','raster'], labels:{lossless:'Không mất dữ liệu (qpdf)', raster:'Raster hoá (mất lớp chữ)'}, default:'lossless', label:'Cách nén' },
  { key:'pages', type:'range', default:'', label:'Khoảng trang', placeholder:'Chỉ dùng khi raster (trống = tất cả)' },
  { key:'dpi', type:'int', min:72, max:600, default:150, label:'DPI khi raster' },
  { key:'format', type:'enum', values:['jpg','png'], labels:{jpg:'JPEG — nhẹ hơn', png:'PNG — nét hơn'}, default:'jpg', label:'Định dạng ảnh' },
  { key:'quality', type:'int', min:60, max:100, default:80, label:'Chất lượng JPEG (%)' },
];
const PASSWORD_RE = /invalid password|file is encrypted|password required/i;
const yieldToEvents = () => new Promise(r => setImmediate(r));

function optionsFor(input = {}) {
  try { return validateOptions({ options: compressOptions }, input); }
  catch { throw new ToolError('INVALID_OPTIONS', 'Tuỳ chọn nén không hợp lệ.'); }
}
function visibleSize(page) { /* crop∩media; normalize rotation; w/h swap 90/270; invalid → INVALID_FILE */ }
function hasUsableOutput(file) { try { return fs.statSync(file).size > 0; } catch { return false; } }
async function loadPdf(file) { /* PDFDocument.load, encrypted → PASSWORD_REQUIRED, else INVALID_FILE */ }
async function compressLossless(ctx, file, beforeBytes) { /* qpdf args; exit3 output; password mapping; page count; publishUnique */ }
async function compressRaster(ctx, file, options, beforeBytes) { /* load; range; render; assert all pages; build new PDF; warning; publish */ }
async function compressTool(ctx) { /* optionsFor, files[0], beforeBytes, dispatch, stats */ }
module.exports = { compressTool, compressOptions };
```

Chi tiết bắt buộc:
- qpdf args: `['--object-streams=generate','--recompress-flate','--compression-level=9','--',file,tmp]`.
- qpdf lỗi: CANCELLED giữ; exit 3 + output dùng; password regex → PASSWORD_REQUIRED; còn lại `INVALID_FILE 'Không đọc được PDF.'`; output thiếu → `INTERNAL`.
- Raster: `parsePageRange(options.pages, pageCount)`; render `{filePath:file,pages,dpi,format,quality:quality/100,outDir:tempDir,signal,progress}`; kiểm đủ từng page; với từng trang i:
  - chọn: `const size = visibleSize(src.getPage(i))`; `out.addPage([size.width,size.height])`; embed ảnh theo format; `drawImage(img,{x:0,y:0,width,height})`.
  - không chọn: `const [p] = await out.copyPages(src,[i]); out.addPage(p);`
- Signal trước/sau render, mỗi trang, sau save.
- Raster errors: `[{ file, code:'TEXT_LAYER_REMOVED', message:'Trang đã được raster hoá; lớp chữ trên các trang đó không còn.' }]` khi selected.length>0.
- Stats: `{beforeBytes, afterBytes: fs.statSync(out).size, savedPercent: Math.round((1-after/before)*100), mode, rasterPages}`; beforeBytes 0 → savedPercent=0.
- Temp cleanup on error.

- [ ] **Step 4: Registry**

Thay dòng compress:
```js
{ id:'compress', group:'optimize', title:'Nén PDF', description:'Giảm dung lượng; raster có cảnh báo mất lớp chữ.', icon:'🗜', accept:['.pdf'], multiple:false, status:'available', options: compressOptions, run: compressTool },
```
Import `compressTool, compressOptions` ở đầu `registry.js`.

- [ ] **Step 5: Renderer kết quả**

Trong `app/renderer/suite.js`:
- `RESULT_WARNINGS.TEXT_LAYER_REMOVED = 'Các trang đã raster hoá không còn lớp chữ.'`.
- Trong `renderResult`, sau danh sách outputs, nếu `r.stats?.beforeBytes > 0 && r.stats?.afterBytes >= 0`, thêm dòng:
  `Dung lượng: <before> → <after> · Giảm <savedPercent>%` (âm thì `Tăng`).
- Dùng helper format bytes (B/KB/MB) bằng textContent.

- [ ] **Step 6: Registry test + E2E**

`registry.test.mjs`: 14 available / 0 planned; id list gồm compress; options compress `mode` default lossless, pages/dpi/format/quality đúng; `#toolGrid` 14 card, 0 disabled, 0 `.st`; danh sách enabled thêm `compress` trước `protect`.
E2E flow:
- Mở `compress`, kiểm mode select default `lossless`, các control hiện.
- Chạy lossless trên fixture 2–4 trang; output `<base>-nen.pdf`; stats before/after/savedPercent; qpdf `--check`; output load đúng số trang; result có chữ “Dung lượng”.
- Chạy lại → `(2)`, file đầu giữ bytes.
- Raster: mode raster, pages `1`, dpi 150, format png; chạy; output; `stats.rasterPages=1`; warning hiển thị; qpdf `--check`; PDF.js page1 không còn text gốc (nếu helper có) hoặc kiểm image XObject; trang 2 vẫn còn text.
- Không làm yếu các assertion cũ.

- [ ] **Step 7: README**

Cập nhật:
- “13 công cụ” → “14 công cụ”, bảng thêm Nén PDF (lossless/raster, `<base>-nen.pdf`).
- Bỏ câu “Nén PDF đang ở trạng thái Sắp có”; giới hạn lossless không hứa giảm nhiều, raster mất lớp chữ trang chọn.
- Các chỗ khác giữ nguyên.

- [ ] **Step 8: Chạy toàn bộ và commit**

Run từ `app/`:
`npm run test:tools`, `npm run test:suite`, `npm test`, và 8 bộ editor (`test:e2e`, `test:overlay`, `test:signature`, `test:erase`, `test:editing`, `test:session`, `test:rotation`, `test:fonts`) — tất cả exit 0.
Commit:
```bash
git add app/suite/pdfops/compress.js app/suite/registry.js app/renderer/suite.js app/test/suite-unit/compress.test.mjs app/test/suite-unit/registry.test.mjs app/test/suite-e2e.mjs README.md
git commit -m "M2: nén PDF lossless và raster"
```

---

## Verification / Acceptance

- 14/14 công cụ available; home 14 thẻ bật, 0 badge.
- Lossless: output hợp lệ, stats before/after, không ghi đè; qpdf exit 3 + output được chấp nhận.
- Raster: đúng trang chọn, kích thước theo CropBox∩MediaBox + rotation, trang khác giữ nguyên, cảnh báo `TEXT_LAYER_REMOVED`.
- Encrypted/corrupt/cancel an toàn; không temp/output dở.
- 8 bộ editor xanh; build không bị ảnh hưởng (không thêm dependency).

## Risks

- qpdf lossless có thể làm file **tăng**; chỉ hiển thị số đo, không hứa giảm.
- Raster ảnh lớn (600 DPI) chậm/nặng; render worker giới hạn 10.000 px như cũ; UI ghi rõ.
- Trang có CropBox lệch/rotation phức tạp: helper `visibleSize` phải khớp cách render worker (viewport).
- Không đổi logic M3/editor; chỉ mở rộng registry/UI result.
