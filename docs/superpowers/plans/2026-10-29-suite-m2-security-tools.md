# M2 — Nhóm Bảo mật: Mở khoá PDF + Xoá metadata

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm 2 công cụ bảo mật còn lại — Mở khoá PDF bằng mật khẩu và Xoá metadata (Info/XMP/đính kèm) — giữ nguyên editor và 8 bộ test cũ.

**Architecture:** Dùng JobRunner/registry/shell/allowlist hiện có. Mở khoá chạy qpdf với mật khẩu trong argfile tạm (không argv/log), publish `<base>-mo-khoa.pdf`. Xoá metadata chạy pdf-lib, xoá Info/XMP/EmbeddedFiles, publish `<base>-xoa-metadata.pdf`. Không thêm binary/dependency.

**Tech Stack:** Electron 33, qpdf 12.4.2 (Apache-2.0), pdf-lib 1.17.1, Playwright core, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-28-ilovepdf-suite-design.md`

## Global Constraints

- Windows x64; offline; no AGPL; no new dependencies; CJS engine; tests ESM with `createRequire`.
- Passwords never on command line or in logs; qpdf argfile deleted in finally.
- No overwrite; `publishUnique`; temp then publish; signal checked.
- Encrypted input without/with wrong password -> `PASSWORD_REQUIRED` / `PASSWORD_INVALID` with short Vietnamese messages.
- Editor and 8 old suites untouched.
- Available tools: after Task 1 = 8, after Task 2 = 9; planned 6 → 5.
- Output: `<base>-mo-khoa.pdf`, `<base>-xoa-metadata.pdf`.

---

## File Structure

**Create**
- `app/suite/pdfops/unlock.js`
- `app/suite/pdfops/metadata.js`
- `app/test/suite-unit/unlock.test.mjs`, `metadata.test.mjs`

**Modify**
- `app/suite/registry.js` — unlock/metadata available/options/runs.
- `app/test/suite-unit/registry.test.mjs` — available/planned counts.
- `app/test/suite-e2e.mjs` — counts + unlock/metadata flows.

**Do not modify**
- Editor files, render worker, existing tools, old tests.

---

## Task 1: Mở khoá PDF

**Files:** create `unlock.js`, test; modify registry/E2E/registry test.

**Interface**
- `unlockTool(ctx)`: option `password` (password, required). qpdf argfile:
  ```
  --password=<password>
  --decrypt
  --
  <input>
  <output-temp>
  ```
- Empty password -> `INVALID_OPTIONS`; CR/LF -> `INVALID_OPTIONS`.
- Wrong password / qpdf password error -> `PASSWORD_INVALID` ("Mật khẩu không đúng. Thử lại."); qpdf exit 3 with valid temp -> accept; other failures -> generic INTERNAL; CANCELLED propagated.
- Output `<base>-mo-khoa.pdf` via `publishUnique`; args file removed in finally; no password in argv/log.
- Registry option label "Mật khẩu hiện có" type password required.

**Tests**
- Create an AES-256 fixture with qpdf (user `secret`), then `unlock`; verify output opens without password (`qpdf --show-encryption` says not encrypted / `--check` without password exits 0), no overwrite on second run.
- Wrong password -> `PASSWORD_INVALID`, no output; empty/CRLF -> `INVALID_OPTIONS`; argfile deleted; spy `ctx.qpdf` receives only `@file` and no secret in args/log.
- Unencrypted input: either copy with warning (if qpdf exit 3) or clear success; document/test chosen behavior.
- E2E: create encrypted PDF, register input/output, open unlock, set password, run; assert output exists and no-password qpdf check succeeds; counts 8 enabled/6 disabled/6 badges; existing flows pass.

**Commit:** `M2: mở khoá PDF bằng mật khẩu`.

---

## Task 2: Xoá metadata

**Files:** create `metadata.js`, test; modify registry/E2E/registry test.

**Interface**
- `metadataTool(ctx)`: options `removeInfo`, `removeXmp`, `removeAttachments` booleans default true; all false -> `INVALID_OPTIONS`.
- Load `PDFDocument.load(bytes, { updateMetadata: false })`.
- removeInfo: set title/author/subject/creator/producer to empty and keywords to [].
- removeXmp: delete catalog `/Metadata` if present.
- removeAttachments: remove `/Names/EmbeddedFiles` (and `/Names` if empty); count removed.
- Save temp, `publishUnique` `<base>-xoa-metadata.pdf`; return `removed` info.
- Encrypted input -> `PASSWORD_REQUIRED`; corrupt -> `INVALID_FILE`; signal checked.
- Registry options booleans with Vietnamese labels.

**Tests**
- Build a PDF with Info (title/author/subject/keywords/creator/producer); run metadata; output Info empty/absent.
- Add an attachment/`EmbeddedFiles` fixture (qpdf `--add-attachment` or pdf-lib low-level) and/or XMP metadata; assert removed; report counts.
- All options false -> `INVALID_OPTIONS`; no overwrite `(2)`; encrypted/corrupt mapping; pre-abort no output.
- E2E: PDF with title/author, open metadata, run defaults; output exists and Info empty; counts 9 enabled/5 disabled/5 badges; existing flows pass.

**Commit:** `M2: xoá metadata PDF`.

---

## Verification / Acceptance

- 9 tools available, 5 planned; home counts/IDs correct.
- Unlock: wrong password rejected, correct password removes encryption, no password in argv/log, no overwrite.
- Metadata: Info/XMP/attachments removed as selected; output valid; encrypted/corrupt mapped.
- `npm run test:tools`, `npm run test:suite`, `npm test`, all 8 old suites, `npm run build`.
- No new dependencies; editor untouched.
