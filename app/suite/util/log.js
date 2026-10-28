const fs = require('node:fs');
const path = require('node:path');

function createLogger(file, { maxBytes = 2 * 1024 * 1024, keep = 3 } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return message => {
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > maxBytes) {
        for (let i = keep - 1; i >= 1; i--) {
          const from = i === 1 ? file : `${file}.${i - 1}`;
          const to = `${file}.${i}`;
          if (fs.existsSync(from)) fs.renameSync(from, to);
        }
      }
      fs.appendFileSync(file, `[${new Date().toISOString()}] ${message}\n`);
    } catch { /* log không được làm hỏng job */ }
  };
}

module.exports = { createLogger };
