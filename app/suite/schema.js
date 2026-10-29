const { ToolError } = require('./errors');

function validateOptions(tool, input = {}) {
  const defs = tool.options || [];
  const out = {};
  for (const opt of defs) {
    const v = input[opt.key];
    if (v === undefined) {
      if (opt.default !== undefined) out[opt.key] = opt.default;
      else if (opt.required) throw invalid(opt);
      continue;
    }
    switch (opt.type) {
      case 'bool':
        out[opt.key] = !!v;
        break;
      case 'int': {
        const n = Number(v);
        if (!Number.isInteger(n) || n < (opt.min ?? -Infinity) || n > (opt.max ?? Infinity)) throw invalid(opt);
        out[opt.key] = n;
        break;
      }
      case 'enum':
        if (!opt.values.includes(v)) throw invalid(opt);
        out[opt.key] = v;
        break;
      case 'range':
        if (typeof v !== 'string') throw invalid(opt);
        out[opt.key] = v;
        break;
      case 'password':
      case 'text':
        if (typeof v !== 'string' || v.length > 500) throw invalid(opt);
        out[opt.key] = v;
        break;
      case 'color':
        if (typeof v !== 'string' || v.length !== 7 || !/^#[0-9a-f]{6}$/i.test(v)) throw invalid(opt);
        out[opt.key] = v;
        break;
      case 'imageFile':
        // Empty is allowed: the tool decides whether an image is required.
        // Paths never reach logs/messages; NUL/CR/LF are rejected at the schema.
        if (typeof v !== 'string' || v.length > 1000 || /[\0\r\n]/.test(v)) throw invalid(opt);
        out[opt.key] = v;
        break;
      default:
        throw invalid(opt);
    }
  }
  for (const key of Object.keys(input)) {
    if (!defs.some(o => o.key === key)) {
      throw new ToolError('INVALID_OPTIONS', `Tuỳ chọn không hợp lệ: ${key}`);
    }
  }
  return out;
}

function invalid(opt) {
  return new ToolError('INVALID_OPTIONS', `Giá trị không hợp lệ cho ${opt.label || opt.key}.`);
}

module.exports = { validateOptions };
