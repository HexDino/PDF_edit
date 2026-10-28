import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ToolError, toPayload } = require('../../suite/errors.js');

function fsError(code, message = 'raw english text C:\\tuyet\\mat\\file.pdf') {
  return Object.assign(new Error(message), { code });
}

test('ENOSPC → DISK_FULL với thông báo tiếng Việt', () => {
  assert.deepEqual(toPayload(fsError('ENOSPC', 'no space left on device')), {
    code: 'DISK_FULL',
    message: 'Không đủ dung lượng.',
  });
});

test('EACCES/EPERM → thông báo quyền ngắn gọn', () => {
  const expected = { code: 'PERMISSION_DENIED', message: 'Không có quyền truy cập file.' };
  assert.deepEqual(toPayload(fsError('EACCES', 'permission denied')), expected);
  assert.deepEqual(toPayload(fsError('EPERM', 'operation not permitted')), expected);
});

test('ENOENT → INVALID_FILE', () => {
  assert.deepEqual(toPayload(fsError('ENOENT', 'ENOENT: no such file C:\\a\\b.pdf')), {
    code: 'INVALID_FILE',
    message: 'File không tồn tại hoặc đã bị di chuyển.',
  });
});

test('EEXIST → OUTPUT_EXISTS', () => {
  assert.deepEqual(toPayload(fsError('EEXIST', 'file already exists')), {
    code: 'OUTPUT_EXISTS',
    message: 'File đích đã tồn tại.',
  });
});

test('mã lạ không lộ message/đường dẫn gốc', () => {
  const payload = toPayload(fsError('EWEIRD', 'lỗi tại C:\\Users\\bi-mat\\a.pdf'));
  assert.deepEqual(payload, { code: 'INTERNAL', message: 'Không xử lý được. Thử lại.' });
  assert.equal(payload.message.includes('C:'), false);
  assert.equal(payload.message.includes('EWEIRD'), false);
});

test('lỗi không có mã và ToolError giữ nguyên', () => {
  assert.deepEqual(toPayload(new Error('boom')), {
    code: 'INTERNAL',
    message: 'Không xử lý được. Thử lại.',
  });
  assert.deepEqual(toPayload(new ToolError('INVALID_FILE', 'File hỏng')), {
    code: 'INVALID_FILE',
    message: 'File hỏng',
  });
});
