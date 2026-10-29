# M2 — Nhóm Đánh dấu: Số trang/Header-Footer + Watermark

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm 2 công cụ còn lại của nhóm Đánh dấu — số trang/header-footer và watermark chữ — đạt 13 công cụ bật/1 sắp có (nén).

**Architecture:** pdf-lib + `@pdf-lib/fontkit` để nhúng Be Vietnam Pro (tiếng Việt), đặt chữ theo toạ độ hiển thị rồi map qua góc xoay trang 0/90/180/270. Dùng JobRunner/registry/publishUnique/allowlist hiện có. Thêm kiểu option `color` cho form generic.

**Tech Stack:** Electron 33, pdf-lib 1.17.1, @pdf-lib/fontkit 1.1.1 (MIT), Playwright core, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-28-ilovepdf-suite-design.md`

## Global Constraints

- Windows x64; offline; no AGPL; new dependency duy nhất: `@pdf-lib/fontkit` (MIT) để nhúng TTF tiếng Việt.
- Engine CommonJS; tests ESM createRequire; editor/8 old suites untouched.
- No overwrite; temp then `publishUnique`; signal checks; encrypted -> PASSWORD_REQUIRED; corrupt -> INVALID_FILE.
- Output: `<base>-so-trang.pdf`, `<base>-watermark.pdf`.
- Available tools: after Task 1 = 12, after Task 2 = 13; planned 2 → 1.
- Text placement must be upright/correct on page rotations 0/90/180/270.

---

## File Structure

**Create**
- `app/suite/pdfops/stamp-common.js` — font loader, color, template, display→PDF mapping, text drawing.
- `app/suite/pdfops/stamp.js`, `app/suite/pdfops/watermark.js`.
- `app/test/suite-unit/stamp-common.test.mjs`, `stamp.test.mjs`, `watermark.test.mjs`.

**Modify**
- `app/package.json` / `package-lock.json` — `@pdf-lib/fontkit`.
- `app/suite/schema.js` — option type `color`.
- `app/renderer/suite.js` — render `<input type=color>` for color.
- `app/suite/registry.js` — stamp/watermark available/options/runs.
- `app/test/suite-unit/registry.test.mjs` — counts.
- `app/test/suite-e2e.mjs` — counts + stamp/watermark flows with text extraction.

---

## Task 1: Font + màu + Số trang/Header-Footer

**Files:** create stamp-common/stamp/tests; modify schema/suite.js/registry/E2E/registry test/package.

**Interfaces**
- `loadStampFont(doc) -> Promise<PDFFont>`: read `renderer/fonts/BeVietnamPro-Regular.ttf` (path from `suite/pdfops/`), register fontkit, embed subset.
- `colorToRgb(hex)`, `formatTemplate(text, {page,total,date})`; date `dd/MM/yyyy`.
- `displayToPdf(box, rotation, dx, dy)`:
  - 0: `[x0+dx, y0+H-dy]`
  - 90: `[x0+dy, y0+dx]`
  - 180: `[x0+W-dx, y0+dy]`
  - 270: `[x0+W-dy, y0+H-dx]`
- `textRotation(extraAngle, pageRotation) = (extraAngle - pageRotation + 360) % 360`.
- `drawDisplayText(page, font, text, {dx, dy, size, color, opacity, extraAngle})` normalizes rotation, maps point, draws with pdf-lib.
- `stampTool(ctx)` options:
  - `leftText`, `centerText` (default `Trang {page}/{total}`), `rightText` text;
  - `fontSize` int 6–48 default 10;
  - `color` color default `#1f2937`;
  - `position` enum `footer|header` default `footer`;
  - `margin` int 0–100 mm default 10;
  - `startAt` int 1–10000 default 1;
  - `pages` range default all.
  - Placeholders `{page}`, `{total}`, `{date}`; page number = startAt + (pageIndex - firstSelectedIndex); total = pageCount + startAt - 1.
  - Layout: left at margin, center centered, right at right margin; footer baseline at H-margin-size, header at margin; 0/90/180/270 upright.
  - Output `<base>-so-trang.pdf` via publishUnique; temp; encrypted/corrupt mapping; signal.
- Registry stamp available with those options; E2E counts 12/2.
- Schema/UI `color` type: `#rrggbb`, input type color.

**Tests**
- stamp-common: template/date; mapping 0/90/180/270 for center/left points; text rotation.
- stamp: page range/startAt/total; no-overwrite; encrypted/corrupt/pre-abort; invalid options. Use fake font? E2E covers real.
- E2E: 3-page PDF (page 2 rotated 90), run stamp center default; extract text via app pdf.js and assert `Trang 1/3`, `Trang 3/3`, date; no overwrite; counts 12/2; existing flows.

**Commit:** `M2: số trang và header/footer`.

---

## Task 2: Watermark chữ

**Files:** create watermark/test; modify registry/E2E/registry test.

**Interfaces**
- `watermarkTool(ctx)` options:
  - `text` text default `BẢN NHÁP`;
  - `fontSize` int 12–200 default 60;
  - `color` color default `#c81e1e`;
  - `opacity` int 0–100 default 20;
  - `angle` int -180–180 default 45;
  - `tile` bool default false;
  - `pages` range default all.
- Text centered (or tiled grid) per page; page-rotation aware via stamp-common; opacity via pdf-lib; output `<base>-watermark.pdf` via publishUnique.
- Tile: grid step based on text width/size, cap ~200 draws/page; skip empty text; encrypted/corrupt/signal.
- Registry watermark available; E2E counts 13/1; text extraction contains watermark; no overwrite.
- Tests: template/opacity/angle mapping; tile count cap; encrypted/corrupt/pre-abort; no overwrite.

**Commit:** `M2: watermark chữ`.

---

## Verification / Acceptance

- 13 tools available, 1 planned (compress); home counts/IDs.
- Stamp: 3 slots/page range/startAt/date/font/color/margin; text correct on rotated pages; no overwrite.
- Watermark: text/size/color/opacity/angle/tile/pages; no overwrite.
- `npm run test:tools`, `npm run test:suite`, `npm test`, all 8 old suites, `npm run build`; packaged font/TTF works.
- No AGPL; editor untouched.
