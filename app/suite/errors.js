class ToolError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
  }
}

// Lỗi hệ thống file chỉ được map sang thông báo tiếng Việt ngắn gọn.
// Không bao giờ chuyển nguyên văn message/code lạ ra UI vì chúng có thể chứa
// đường dẫn tuyệt đối hoặc thông điệp tiếng Anh của hệ điều hành.
const FS_ERRORS = {
  ENOSPC: ['DISK_FULL', 'Không đủ dung lượng.'],
  EACCES: ['PERMISSION_DENIED', 'Không có quyền truy cập file.'],
  EPERM: ['PERMISSION_DENIED', 'Không có quyền truy cập file.'],
  ENOENT: ['INVALID_FILE', 'File không tồn tại hoặc đã bị di chuyển.'],
  EEXIST: ['OUTPUT_EXISTS', 'File đích đã tồn tại.'],
};

function toPayload(error) {
  if (error instanceof ToolError) return { code: error.code, message: error.message };
  const mapped = FS_ERRORS[error?.code];
  if (mapped) return { code: mapped[0], message: mapped[1] };
  return { code: 'INTERNAL', message: 'Không xử lý được. Thử lại.' };
}

module.exports = { ToolError, toPayload, FS_ERRORS };
