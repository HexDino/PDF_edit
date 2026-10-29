# M2 — Nhóm Chuyển đổi: Ảnh → PDF + HTML → PDF

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm 2 công cụ chuyển đổi — ghép ảnh thành PDF (JPG/PNG/WebP) và in HTML local thành PDF — vào suite, đạt 11 công cụ bật/3 sắp có.

**Architecture:** Dùng JobRunner/registry/shell/allowlist hiện có. Ảnh→PDF chạy pdf-lib; WebP được giải mã qua một hidden BrowserWindow (canvas) và chuyển PNG tạm. HTML→PDF dùng hidden BrowserWindow `printToPDF`, chặn mọi request mạng. Không thêm dependency.

**Tech Stack:** Electron 33, pdf-lib 1.17.1, Chromium canvas/printToPDF, Playwright core, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-28-ilovepdf-suite-design.md`

## Global Constraints

- Windows x64; offline; no AGPL; no new dependencies; CJS engine; tests ESM createRequire.
- No overwrite; temp then `publishUnique`; signal checks; short Vietnamese errors.
- Images output `<base>-anh.pdf`; HTML output `<base>-html.pdf`.
- HTML → PDF must block http(s)/ws(s); only local file/resources.
- Editor and 8 old suites untouched.
- Available tools: after Task 1 = 10, after Task 2 = 11; planned 4 → 3.

---

## File Structure

**Create**
- `app/suite/pdfops/images-pdf.js`
- `app/suite/image-worker.js`, `app/suite/image-worker-preload.js`
- `app/renderer/worker/image.html`, `app/renderer/worker/image.js`
- `app/suite/pdfops/html-pdf.js`
- `app/suite/html-printer.js`
- `app/test/suite-unit/images-pdf.test.mjs`, `html-pdf.test.mjs` (tool-level where possible).

**Modify**
- `app/main.js` — register `imgsrc`, create image/html services, pass to JobRunner, cleanup.
- `app/suite/jobs.js` — inject `image`/`printHtml` services into ctx.
- `app/suite/registry.js` — images-pdf/html-pdf available/options/runs.
- `app/test/suite-unit/registry.test.mjs` — counts.
- `app/test/suite-e2e.mjs` — counts + image/html flows.

---

## Task 1: Ảnh → PDF

**Files:** create images-pdf/image worker; modify main/jobs/registry/E2E/registry test.

**Interfaces**
- `imagesTool(ctx)`: multiple images in order; options:
  - `pageSize` enum `auto|A4|A3|Letter` default `A4`;
  - `orientation` enum `auto|portrait|landscape` default `auto`;
  - `margin` int 0–50 mm default 10.
- JPG/PNG embedded directly with pdf-lib; WebP converted to PNG via `ctx.image.toPng(filePath)` (hidden worker), then embedded.
- Page points: A4 595.28×841.89, A3 841.89×1190.55, Letter 612×792; auto = image size (points) + margins. Orientation swaps as needed. Image contained and centered in the printable area.
- Output `<base>-anh.pdf` via `publishUnique`; progress per image; invalid image -> `INVALID_FILE`; signal checks; no overwrite.
- Registry `images-pdf` available, multiple true, accept `.png/.jpg/.jpeg/.webp`, options above.

**Image worker**
- Hidden BrowserWindow loads `renderer/worker/image.html`; preload exposes `onTask/done/error` with sender checks.
- `imgsrc` token protocol serves one image path per task (MIME by extension); no path from request.
- Worker draws the image to canvas and returns PNG bytes + width/height; main writes temp PNG; tasks serialized; readiness handshake; abort resets worker; crash rejects pending.
- `ctx.image.toPng(filePath)` returns temp PNG path/dimensions.

**Tests**
- Unit: JPG/PNG order, page count, A4/Letter/auto dimensions, portrait/landscape swap, margin, no-overwrite `(2)`, invalid file, pre-abort. Use `test/sig-photo.jpg` and a small generated PNG (base64).
- WebP: E2E or unit with a tiny WebP fixture; assert conversion path used.
- E2E: 2 images -> 2 A4 pages; order; PNG/JPG; counts 10 enabled/4 disabled/4 badges; existing flows pass.

**Commit:** `M2: ảnh sang PDF (JPG/PNG/WebP)`.

---

## Task 2: HTML → PDF

**Files:** create html-pdf tool + printer; modify main/jobs/registry/E2E/registry test.

**Interfaces**
- `htmlTool(ctx)`: single `.html/.htm`; options:
  - `pageSize` enum `A4|A3|Letter` default `A4`;
  - `landscape` bool default false;
  - `printBackground` bool default true;
  - `margin` int 0–50 mm default 10.
- `ctx.printHtml({ filePath, pageSize, landscape, printBackground, marginMm, signal }) -> Buffer` using hidden BrowserWindow.
- Printer: separate session partition; block http/https/ws/wss via `webRequest.onBeforeRequest`; deny window.open/navigation; contextIsolation/no node; wait `did-finish-load` + `document.fonts.ready` + short settle; `printToPDF({ pageSize, landscape, printBackground, margins: {top/right/bottom/left: mm/25.4}, scale: 1 })`; abort destroys window; serialize tasks; destroy on quit.
- Output `<base>-html.pdf` via publishUnique; temp buffer; no overwrite.
- Registry `html-pdf` available, accept `.html/.htm`, options above; counts 11/3.

**Tests**
- E2E: create local HTML with heading/CSS; run; assert PDF pages >=1, A4 dimensions (approx 595×842), file exists; no network (HTML with remote image should not fetch; verify output still generated).
- Unit-level: registry/option validation; no Node print test (Electron only).
- Counts 11 enabled/3 disabled/3 badges; existing flows pass.
- Full regression/build at end.

**Commit:** `M2: HTML sang PDF`.

---

## Verification / Acceptance

- 11 tools available, 3 planned; home counts/IDs.
- Images: order/page size/orientation/margin; WebP conversion; no overwrite.
- HTML: A4/A3/Letter, margins, background, landscape; network blocked; no overwrite; temp cleanup.
- `npm run test:tools`, `npm run test:suite`, `npm test`, 8 old suites, `npm run build`.
- No new dependencies; editor untouched.
