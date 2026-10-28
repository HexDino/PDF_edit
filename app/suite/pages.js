const { ToolError } = require('./errors');

function parsePageRange(spec, pageCount) {
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new ToolError('INVALID_RANGE', 'PDF không có trang nào.');
  }
  const raw = String(spec ?? '').trim();
  if (!raw) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const out = [];
  for (const part of raw.split(',')) {
    const token = part.trim();
    const m = /^(\d+)(?:-(\d*))?$/.exec(token);
    if (!m) throw invalid(spec);
    const a = Number(m[1]);
    const b = m[2] === undefined ? a : m[2] === '' ? pageCount : Number(m[2]);
    if (a < 1 || b < a || b > pageCount) throw invalid(spec);
    for (let i = a; i <= b; i++) out.push(i);
  }
  return out;
}

function invalid(spec) {
  return new ToolError('INVALID_RANGE', `Khoảng trang không hợp lệ: ${spec}`);
}

module.exports = { parsePageRange };
