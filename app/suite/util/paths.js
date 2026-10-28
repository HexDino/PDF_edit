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
