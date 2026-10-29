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
- `displayToPdf(box, rotation, dx, dy)` maps a top-left display point into the visible CropBox:
  - 0: `[x0+dx, y0+H-dy]`
  - 90: `[x0+dy, y0+dx]`
  - 180: `[x0+W-dx, y0+dy]`
  - 270: `[x0+W-dy, y0+H-dx]`
- `textRotation(extraAngle, pageRotation) = (extraAngle + pageRotation) % 360` — positive page
  rotation, matching the editor export (`renderer/app.js` uses `rot + g.rot`). The earlier
  minus-rotation sketch was wrong; upstream rendered checks must prove upright text at
  0/90/180/270.
- `drawDisplayText(page, font, text, {dx, dy, size, color, opacity, extraAngle})` normalizes rotation, maps point, draws with pdf-lib.
- Visible page box = intersection of CropBox and MediaBox; never expand existing crops.
- Text metrics (ascender/descender) determine header/footer baselines so margin 0 does not
  clip descenders; impossible layout or overflowing text is `INVALID_OPTIONS`.
- `stampTool(ctx)` options:
  - `leftText`, `centerText` (default `Trang {page}/{total}`), `rightText` text;
  - `fontSize` int 6–48 default 10;
  - `color` color default `#1f2937`;
  - `position` enum `footer|header` default `footer`;
  - `margin` int 0–100 mm default 10;
  - `startAt` int 1–10000 default 1;
  - `pages` range default all.
  - Placeholders `{page}`, `{total}`, `{date}`; selected pages are sorted/deduplicated in
    document order and numbered consecutively from `startAt`; `total` = `startAt + số trang
    đã chọn - 1` (brief's firstSelected/total formula superseded).
  - Layout: left at margin, center centered, right at right margin; header/footer margin
    measures visible glyph bounds; 0/90/180/270 upright; text that cannot fit is rejected.
  - Output `<base>-so-trang.pdf` via publishUnique; temp; encrypted/corrupt mapping; signal.
- Registry stamp available with those options; E2E counts 12/2.
- Schema/UI `color` type: `#rrggbb`, input type color.

**Tests**
- stamp-common: template/date; mapping 0/90/180/270 for center/left points; text rotation.
- stamp: page range/startAt/total; no-overwrite; encrypted/corrupt/pre-abort; invalid options. Use fake font? E2E covers real.
- E2E: 3-page PDF (page 2 rotated 90), run stamp center default; extract text via app pdf.js and assert `Trang 1/3`, `Trang 3/3`, date; no overwrite; counts 12/2; existing flows.

**Commit:** `M2: số trang và header/footer`.

---

## Task 2: Watermark chữ và ảnh

**Files:** create watermark/test; modify registry/E2E/registry test; main/preload/suite.js for
the image picker option; THIRD-PARTY-NOTICES unchanged.

**Interfaces**
- `watermarkTool(ctx)` options:
  - `kind` enum `text|image`, default `text`;
  - `text` text default `BẢN NHÁP` (used when kind=text; empty text invalid);
  - `imagePath` type `imageFile` (required when kind=image; only paths chosen via the app's
    native picker / registered inputs; main rejects unallowlisted or non-PNG/JPG paths);
  - `fontSize` int 12–200 default 60;
  - `color` color default `#c81e1e`;
  - `opacity` int 0–100 default 20;
  - `angle` int -180–180 default 45 (visual angle in display space, page-rotation aware);
  - `tile` bool default false;
  - `margin` int 0–100 mm default 0 (inset for the tiled grid);
  - `pages` range default all.
- Text centered (or tiled grid) per page; page-rotation aware via stamp-common; opacity via
  pdf-lib graphics state. Image watermark embeds PNG/JPG with the same opacity/rotation
  rules, scaled down when larger than the visible page area, and is never upscaled.
- Tile: grid step based on the watermark's rotated bounding size, cap 200 draws/page; text
  and image share the same grid.
- Output `<base>-watermark.pdf` via publishUnique; encrypted/corrupt/signal.
- Registry watermark available; E2E counts 13/1; text extraction contains watermark text;
  image watermark renders pixels; no overwrite.
- UI image option: renderer adds a "Chọn ảnh" button using `pickFiles({accept:['.png','.jpg','.jpeg'],multiple:false})`
  and shows the chosen file name; `jobStart` sends `imagePath`; main validates it against
  the allowlist and jobs.js validates existence/extension again.
- Tests: template/opacity/angle mapping; image embed (PNG + JPG), oversized scaling; tile
  count cap; encrypted/corrupt/pre-abort; no overwrite; path not chosen → INVALID_OPTIONS.

**Commit:** `M2: watermark chữ và ảnh`.

---

## Verification / Acceptance

- 13 tools available, 1 planned (compress); home counts/IDs.
- Stamp: 3 slots/page range/startAt/date/font/color/margin; text correct on rotated pages; no overwrite.
- Watermark: text/size/color/opacity/angle/tile/pages; no overwrite.
- `npm run test:tools`, `npm run test:suite`, `npm test`, all 8 old suites, `npm run build`; packaged font/TTF works.
- No AGPL; editor untouched.
