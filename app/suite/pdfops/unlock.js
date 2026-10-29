const fs = require('node:fs');
const path = require('node:path');
const { ToolError } = require('../errors');
const { outputName, publishUnique } = require('../util/paths');

// qpdf chỉ báo sai/thiếu mật khẩu khi mở file đầu vào đã mã hoá.
// Không bao giờ đưa nguyên văn stderr (có thể chứa đường dẫn) ra UI.
const PASSWORD_RE = /invalid password|file is encrypted|password required/i;

// qpdf trả mã 3 khi có cảnh báo nhưng vẫn tạo được file (vd. PDF hỏng nhẹ).
// Chỉ chấp nhận mã 3 khi file tạm thực sự dùng được; còn lại vẫn là lỗi.
function hasUsableOutput(file) {
  try {
    return fs.statSync(file).size > 0;
  } catch {
    return false;
  }
}

async function unlockTool(ctx) {
  const file = ctx.files[0];
  const password = ctx.options.password;

  // Mật khẩu là bắt buộc; mật khẩu trống không thể phân biệt với "không nhập".
  if (typeof password !== 'string' || password === '') {
    throw new ToolError('INVALID_OPTIONS', 'Hãy nhập mật khẩu hiện có.');
  }
  // Mỗi dòng trong file đối số là một đối số, nên CR/LF sẽ tách mật khẩu
  // thành nhiều đối số và làm lộ phần sau ra dòng lệnh của qpdf.
  if (/[\r\n]/.test(password)) {
    throw new ToolError('INVALID_OPTIONS', 'Mật khẩu không hợp lệ.');
  }

  const tmp = path.join(ctx.tempDir, 'unlocked.pdf');
  const argFile = path.join(ctx.tempDir, 'qpdf-args.txt');
  // Mỗi dòng là một đối số của qpdf nên mật khẩu có dấu cách vẫn nguyên vẹn;
  // nhờ vậy mật khẩu không bao giờ xuất hiện trên dòng lệnh hay trong log.
  // Dùng dạng --password=... để mật khẩu bắt đầu bằng "-" hoặc "@" không bị
  // hiểu nhầm thành tuỳ chọn/tệp đối số.
  const lines = [
    `--password=${password}`,
    '--decrypt',
    '--',
    file,
    tmp,
  ];

  try {
    fs.writeFileSync(argFile, lines.join('\n') + '\n', { encoding: 'utf8', mode: 0o600 });
    await ctx.qpdf(['@' + argFile]);
  } catch (e) {
    if (e.code === 'CANCELLED') throw e;
    // qpdf exit code 3 = chỉ có cảnh báo; file tạm vẫn dùng được.
    if (!(e.exitCode === 3 && hasUsableOutput(tmp))) {
      if (PASSWORD_RE.test(`${e.stderr || ''} ${e.message || ''}`)) {
        throw new ToolError('PASSWORD_INVALID', 'Mật khẩu không đúng. Thử lại.');
      }
      throw new ToolError('INTERNAL', 'Không mở khoá được PDF.');
    }
  } finally {
    try { fs.rmSync(argFile, { force: true }); } catch { /* temp sẽ được job dọn dẹp */ }
  }

  ctx.signal?.throwIfAborted?.();
  if (!hasUsableOutput(tmp)) throw new ToolError('INTERNAL', 'qpdf không tạo được file.');
  const outDir = ctx.outputDir || path.dirname(file);
  // publishUnique sao chép theo kiểu exclusive nên không bao giờ ghi đè;
  // file đầu vào chưa mã hoá cũng được qpdf ghi lại thành bản sạch.
  const out = publishUnique(tmp, outDir, outputName(file, 'mo-khoa'));
  return { outputs: [{ path: out }], errors: [], stats: {} };
}

module.exports = { unlockTool };
