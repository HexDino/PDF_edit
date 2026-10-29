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

function uniqueDir(dir, name, exists = fs.existsSync) {
  let candidate = path.join(dir, name);
  if (!exists(candidate)) return candidate;
  for (let i = 2; i < 10000; i++) {
    candidate = path.join(dir, `${name} (${i})`);
    if (!exists(candidate)) return candidate;
  }
  throw new Error('Không tìm được tên thư mục trống');
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

// Xuất bản file tạm ra tên đích mà không bao giờ ghi đè file đã có.
// COPYFILE_EXCL tạo đích theo kiểu exclusive nên hai job chạy song song
// chọn cùng tên sẽ chỉ một job thắng; job còn lại thử (2), (3), …
function publishUnique(tempFile, dir, proposedName) {
  fs.mkdirSync(dir, { recursive: true });
  const { base, ext } = splitExt(proposedName);
  for (let i = 1; i < 10000; i++) {
    const candidate = path.join(dir, i === 1 ? proposedName : `${base} (${i})${ext}`);
    try {
      fs.copyFileSync(tempFile, candidate, fs.constants.COPYFILE_EXCL);
    } catch (e) {
      if (e.code === 'EEXIST') continue;
      try { fs.unlinkSync(candidate); } catch { /* chưa tạo được file đích */ }
      throw e;
    }
    try { fs.unlinkSync(tempFile); } catch { /* temp sẽ được job dọn dẹp */ }
    return candidate;
  }
  throw new Error('Không tìm được tên file trống');
}

module.exports = { binaryPath, splitExt, outputName, uniquePath, uniqueDir, moveAtomic, publishUnique };
