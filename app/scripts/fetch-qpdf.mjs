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
