class ToolError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
  }
}

function toPayload(error) {
  if (error instanceof ToolError) return { code: error.code, message: error.message };
  if (error?.code && typeof error.message === 'string') return { code: error.code, message: error.message };
  return { code: 'INTERNAL', message: 'Không xử lý được. Thử lại.' };
}

module.exports = { ToolError, toPayload };
