const fs = require('node:fs');
const path = require('node:path');
const { ToolError } = require('../errors');
const { outputName, publishUnique } = require('../util/paths');

// qpdf chỉ báo sai/thiếu mật khẩu khi mở file đầu vào đã mã hoá.
// Không bao giờ đưa nguyên văn stderr (có thể chứa đường dẫn) ra UI.
const PASSWORD_RE = /invalid password|file is encrypted|password required/i;

async function protect(ctx) {
  const file = ctx.files[0];
  const open = ctx.options.openPassword || '';
  const owner = ctx.options.ownerPassword || open;
  if (!open) throw new ToolError('INVALID_OPTIONS', 'Hãy nhập mật khẩu mở.');
  if (/[\r\n]/.test(open) || /[\r\n]/.test(owner)) {
    throw new ToolError('INVALID_OPTIONS', 'Mật khẩu không hợp lệ.');
  }

  const tmp = path.join(ctx.tempDir, 'protected.pdf');
  const argFile = path.join(ctx.tempDir, 'qpdf-args.txt');
  const modify = !!ctx.options.allowModify;
  // Mỗi dòng là một đối số của qpdf nên mật khẩu có dấu cách vẫn nguyên vẹn;
  // nhờ vậy mật khẩu không bao giờ xuất hiện trên dòng lệnh hay trong log.
  // Dùng dạng --user-password=/--owner-password= (qpdf 11.7+) để mật khẩu bắt
  // đầu bằng "-" hoặc "@" không bị hiểu nhầm thành tuỳ chọn/tệp đối số.
  const lines = [
    '--encrypt',
    `--user-password=${open}`,
    `--owner-password=${owner}`,
    '--bits=256',
    `--print=${ctx.options.allowPrint ? 'full' : 'none'}`,
    `--modify=${modify ? 'all' : 'none'}`,
    `--extract=${ctx.options.allowCopy ? 'y' : 'n'}`,
    `--annotate=${modify ? 'y' : 'n'}`,
    `--form=${modify ? 'y' : 'n'}`,
    `--accessibility=${modify ? 'y' : 'n'}`,
    `--assemble=${modify ? 'y' : 'n'}`,
    `--modify-other=${modify ? 'y' : 'n'}`,
    '--', file, tmp,
  ];

  try {
    fs.writeFileSync(argFile, lines.join('\n') + '\n', { encoding: 'utf8', mode: 0o600 });
    await ctx.qpdf(['@' + argFile]);
  } catch (e) {
    if (e.code === 'CANCELLED') throw e;
    if (PASSWORD_RE.test(`${e.stderr || ''} ${e.message || ''}`)) {
      throw new ToolError('PASSWORD_REQUIRED', 'PDF đã được mã hoá; cần mở khoá trước khi đặt mật khẩu mới.');
    }
    throw new ToolError('INTERNAL', 'Không khoá được PDF.');
  } finally {
    try { fs.rmSync(argFile, { force: true }); } catch { /* temp sẽ được job dọn dẹp */ }
  }

  ctx.signal?.throwIfAborted?.();
  if (!fs.existsSync(tmp)) throw new ToolError('INTERNAL', 'qpdf không tạo được file.');
  const outDir = ctx.outputDir || path.dirname(file);
  const out = publishUnique(tmp, outDir, outputName(file, 'khoa'));
  return { outputs: [{ path: out }], errors: [], stats: {} };
}

module.exports = { protect };
