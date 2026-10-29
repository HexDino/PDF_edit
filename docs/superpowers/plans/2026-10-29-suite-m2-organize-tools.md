# M2 — Nhóm công cụ Tổ chức: Kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm 4 công cụ nhóm Tổ chức — Tách PDF, Xoá & trích trang, Tổ chức trang, Crop PDF — vào shell/engine hiện có, giữ nguyên editor và 8 bộ test cũ.

**Architecture:** Dùng lại JobRunner/registry/shell/allowlist của M1. Bốn công cụ chạy trong main process bằng pdf-lib (copy/remove/rotate/crop trang) và publish qua `publishUnique`/`uniqueDir`; không cần binary mới. UI dùng form generic hiện có (range/order/text/int/enum); giao diện thumbnail kéo-thả nằm ở M3.

**Tech Stack:** Electron 33, pdf-lib 1.17.1, qpdf 12.4.2 (không dùng cho 4 tool này), Playwright core, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-28-ilovepdf-suite-design.md`

## Global Constraints

- Windows x64; offline; no AGPL; no new dependencies.
- Engine CommonJS `.js`; tests ESM `.mjs` using `createRequire`.
- Keep editor files and 8 old suites unchanged.
- One JobRunner; no overwrite; temp then publish; cancel cleans partial output/folder.
- Input encrypted -> `PASSWORD_REQUIRED`; corrupt -> `INVALID_FILE`; short Vietnamese UI errors.
- Output naming: split folder `<base>-tach/`; pages `<base>-xoa-trang.pdf` / `<base>-trich-trang.pdf`; organize `<base>-to-chuc.pdf`; crop `<base>-crop.pdf`.
- Home available count after Task 1: 5 (merge, split, pages, pdf-images, protect); after Task 2: 7 (adds organize, crop). Planned 9 → 7.
- No visual thumbnail/reorder UI in this plan; M3 redesign.

---

## File Structure

**Create**
- `app/suite/pdfops/split.js` — split tool.
- `app/suite/pdfops/pageops.js` — delete/extract tool.
- `app/suite/pdfops/reorder.js` — organize tool.
- `app/suite/pdfops/crop.js` — crop tool.
- `app/test/suite-unit/split.test.mjs`, `pageops.test.mjs`, `reorder.test.mjs`, `crop.test.mjs`.

**Modify**
- `app/suite/pages.js` — add `parsePageSegments`.
- `app/suite/registry.js` — 4 tools available/options/runs.
- `app/test/suite-unit/pages.test.mjs` — segment tests.
- `app/test/suite-unit/registry.test.mjs` — available/planned counts.
- `app/test/suite-e2e.mjs` — counts + flows for 4 tools.

**Do not modify**
- `app/renderer/app.js`, `app/renderer/editor.html`, editor tests, worker/protect/render files.

---

## Task 1: Tách PDF + Xoá & trích trang

**Files:** create `split.js`, `pageops.js`, tests; modify `pages.js`, registry, E2E counts/flows, registry test.

**Interfaces**
- `parsePageSegments(spec, pageCount) -> number[][]` — each comma segment is one output chunk; validates bounds; empty spec = one segment of all pages.
- `splitPdf(ctx)`: options `mode` (`ranges|every-n|each-page`), `ranges` text, `every` int (1–1000). Output folder `uniqueDir(root, base+'-tach')`, files `<base>-01.pdf`…; no ZIP.
- `pagesTool(ctx)`: options `mode` (`delete|extract`), `pages` range. Delete removes pages; extract preserves requested order/duplicates; delete-all -> `NO_PAGES`. Output via `publishUnique`.
- Both load via pdf-lib; encrypted -> `PASSWORD_REQUIRED`; corrupt -> `INVALID_FILE`; signal checked between outputs; partial split folder removed on error/cancel.

**Tests**
- `parsePageSegments('1-3,5',6)` -> `[[1,2,3],[5]]`; empty -> `[[1..6]]`; invalid/reversed/out-of-range -> `INVALID_RANGE`.
- split ranges on a 5-page PDF with distinct widths -> 2 files, widths `[1,2]`, `[4]`; every-n 2 -> 3 files; each-page -> 5; second run gets `(2)` folder.
- pages delete `2,4` -> widths `[1,3,5]`; extract `4,2,2` -> widths `[4,2,2]`; delete all -> `NO_PAGES`.
- encrypted fixture -> `PASSWORD_REQUIRED`; no output.
- E2E: create 4-page PDF; split `1-2,4` -> 2 files (2/1 pages); extract `2,4` -> 2 pages; counts 5 enabled/9 disabled/9 badges; existing merge/pdf-images/protect flows still pass.

**Wiring**
- Registry: `split` and `pages` status available; option schemas:
  - split: `mode` enum values `ranges/every-n/each-page`, default `ranges`; `ranges` text placeholder `1-3,5 (trống = tất cả)`; `every` int min 1 max 1000 default 2.
  - pages: `mode` enum `delete/extract` default `extract`; `pages` range placeholder `1-3,5 (bắt buộc khi xoá)`.
- Update registry test (`>=9` planned after Task 1; `>=7` after Task 2) and `tools.length` 14.
- Commit: `M2: tách PDF và xoá/trích trang`.

---

## Task 2: Tổ chức trang + Crop PDF

**Files:** create `reorder.js`, `crop.js`, tests; modify registry, E2E counts/flows, registry test.

**Interfaces**
- `organizeTool(ctx)`: options `order` text (comma-separated original page numbers; empty = all; duplicates allowed), `rotate` enum `0|90|180|270` (applied to every output page), `blankCount` int 0–50 (append blank pages at end using last page size). Output `<base>-to-chuc.pdf` via `publishUnique`.
- `cropTool(ctx)`: options `top/right/bottom/left` ints 0–200 (mm), `pages` range (empty = all). Set CropBox in unrotated PDF coordinates with margins mapped through page rotation:
  - 0: `[L,R,T,B]`;
  - 90: unrotated `L=disp.top, R=disp.bottom, T=disp.right, B=disp.left`;
  - 180: `L=disp.right, R=disp.left, T=disp.bottom, B=disp.top`;
  - 270: `L=disp.bottom, R=disp.top, T=disp.left, B=disp.right`.
  - Reject if resulting width/height < 1pt; output `<base>-crop.pdf` via `publishUnique`.
- Both load pdf-lib; encrypted/corrupt mapping; signal checks.

**Tests**
- organize order `3,1,2` -> widths in that order; duplicates `1,1,2` -> 3 pages; rotate 90 -> page rotation 90/450 preserved as 90; blankCount 2 -> +2 blank pages (last page size).
- crop 10mm on 0/90/180/270 pages -> CropBox matches expected mapping; invalid pages -> `INVALID_RANGE`.
- E2E: organize with order `3,1,2`, rotate 90, blankCount 1 -> 4 pages, rotation 90, last blank; crop top/right/bottom/left 10mm on all -> CropBox; counts 7 enabled/7 disabled/7 badges; existing flows still pass.

**Wiring**
- Registry: `organize` and `crop` available; option schemas:
  - organize: `order` text placeholder `3,1,2 (trống = giữ nguyên)`; `rotate` enum `0/90/180/270` default 0; `blankCount` int 0–50 default 0.
  - crop: `top/right/bottom/left` int 0–200 default 0 with labels mm; `pages` range placeholder `1-3,5 (trống = tất cả)`.
- Update registry test planned count to 7; E2E counts 7/7/7.
- Commit: `M2: tổ chức trang và crop PDF`.

---

## Verification / Acceptance

- 7 tools available, 7 planned; home counts/IDs correct.
- Split/pages/organize/crop outputs correct page order/count/rotation/CropBox; no overwrite; cancel cleans temp/folder.
- Encrypted/corrupt inputs mapped; no raw errors.
- `npm run test:tools`, `npm run test:suite`, `npm test`, all 8 old suites; `npm run build`.
- No new dependencies; editor untouched.
