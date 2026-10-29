const { merge } = require('./pdfops/organize');
const { splitPdf } = require('./pdfops/split');
const { pagesTool } = require('./pdfops/pageops');
const { organizeTool } = require('./pdfops/reorder');
const { cropTool } = require('./pdfops/crop');
const { pdfImages } = require('./pdfops/convert');
const { protect } = require('./pdfops/security');
const { unlockTool } = require('./pdfops/unlock');
const { metadataTool } = require('./pdfops/metadata');

const TOOLS = [
  { id: 'merge', group: 'organize', title: 'Ghép PDF', description: 'Ghép nhiều file thành một, đổi được thứ tự.', icon: '⧉', accept: ['.pdf'], multiple: true, minFiles: 2, status: 'available', options: [], run: merge },
  { id: 'split', group: 'organize', title: 'Tách PDF', description: 'Tách theo khoảng trang hoặc từng trang.', icon: '✂', accept: ['.pdf'], multiple: false, status: 'available', options: [
    { key: 'mode', type: 'enum', values: ['ranges', 'every-n', 'each-page'], labels: { ranges: 'Theo khoảng trang', 'every-n': 'Mỗi N trang', 'each-page': 'Mỗi trang một file' }, default: 'ranges', label: 'Cách tách' },
    { key: 'ranges', type: 'text', default: '', label: 'Khoảng trang', placeholder: '1-3,5 (trống = tất cả)' },
    { key: 'every', type: 'int', min: 1, max: 1000, default: 2, label: 'Số trang mỗi file' },
  ], run: splitPdf },
  { id: 'pages', group: 'organize', title: 'Xoá & trích trang', description: 'Chọn trang để xoá hoặc trích thành file mới.', icon: '▤', accept: ['.pdf'], multiple: false, status: 'available', options: [
    { key: 'mode', type: 'enum', values: ['delete', 'extract'], labels: { delete: 'Xoá trang', extract: 'Trích trang' }, default: 'extract', label: 'Chế độ' },
    { key: 'pages', type: 'range', label: 'Khoảng trang', placeholder: '1-3,5 (bắt buộc khi xoá)' },
  ], run: pagesTool },
  { id: 'organize', group: 'organize', title: 'Tổ chức trang', description: 'Đổi thứ tự, xoay, nhân bản, chèn trang trắng.', icon: '⇅', accept: ['.pdf'], multiple: false, status: 'available', options: [
    { key: 'order', type: 'text', default: '', label: 'Thứ tự trang', placeholder: '3,1,2 (trống = giữ nguyên)' },
    { key: 'rotate', type: 'enum', values: ['0', '90', '180', '270'], default: '0', label: 'Xoay tất cả trang' },
    { key: 'blankCount', type: 'int', min: 0, max: 50, default: 0, label: 'Số trang trắng thêm cuối' },
  ], run: organizeTool },
  { id: 'crop', group: 'organize', title: 'Crop PDF', description: 'Cắt lề trang theo khung tuỳ chọn.', icon: '⌗', accept: ['.pdf'], multiple: false, status: 'available', options: [
    { key: 'top', type: 'int', min: 0, max: 200, default: 0, label: 'Lề trên (mm)' },
    { key: 'right', type: 'int', min: 0, max: 200, default: 0, label: 'Lề phải (mm)' },
    { key: 'bottom', type: 'int', min: 0, max: 200, default: 0, label: 'Lề dưới (mm)' },
    { key: 'left', type: 'int', min: 0, max: 200, default: 0, label: 'Lề trái (mm)' },
    { key: 'pages', type: 'range', label: 'Khoảng trang', placeholder: '1-3,5 (trống = tất cả)' },
  ], run: cropTool },
  { id: 'stamp', group: 'stamp', title: 'Số trang & header/footer', description: 'Đánh số trang và chèn tiêu đề/chân trang.', icon: '#', accept: ['.pdf'], multiple: false, status: 'planned', options: [] },
  { id: 'watermark', group: 'stamp', title: 'Watermark', description: 'Chèn chữ hoặc ảnh mờ lên trang.', icon: '◈', accept: ['.pdf'], multiple: false, status: 'planned', options: [] },
  { id: 'pdf-images', group: 'convert', title: 'PDF → ảnh', description: 'Xuất từng trang thành JPG hoặc PNG.', icon: '🖼', accept: ['.pdf'], multiple: false, status: 'available', options: [
    { key: 'pages', type: 'range', label: 'Khoảng trang', placeholder: '1-3,5,8- (trống = tất cả)' },
    { key: 'dpi', type: 'int', min: 72, max: 600, default: 150, label: 'DPI' },
    { key: 'format', type: 'enum', values: ['jpg', 'png'], labels: { jpg: 'JPG — nhẹ hơn', png: 'PNG — nét hơn' }, default: 'jpg', label: 'Định dạng' },
    { key: 'quality', type: 'int', min: 60, max: 100, default: 90, label: 'Chất lượng JPEG (%)' },
  ], run: pdfImages },
  { id: 'images-pdf', group: 'convert', title: 'Ảnh → PDF', description: 'Ghép ảnh thành một PDF theo thứ tự.', icon: '🖼', accept: ['.png', '.jpg', '.jpeg'], multiple: true, minFiles: 1, status: 'planned', options: [] },
  { id: 'html-pdf', group: 'convert', title: 'HTML → PDF', description: 'In file HTML local thành PDF.', icon: '⟨/⟩', accept: ['.html', '.htm'], multiple: false, status: 'planned', options: [] },
  { id: 'compress', group: 'optimize', title: 'Nén PDF', description: 'Giảm dung lượng, có cảnh báo mất lớp chữ.', icon: '🗜', accept: ['.pdf'], multiple: false, status: 'planned', options: [] },
  { id: 'protect', group: 'security', title: 'Khoá PDF', description: 'Đặt mật khẩu mở/chủ và hạn chế quyền.', icon: '🔒', accept: ['.pdf'], multiple: false, status: 'available', options: [
    { key: 'openPassword', type: 'password', default: '', label: 'Mật khẩu mở (trống = chỉ mở bằng mật khẩu chủ)' },
    { key: 'ownerPassword', type: 'password', default: '', label: 'Mật khẩu chủ (bắt buộc khi hạn chế quyền)', placeholder: 'Trùng mật khẩu mở nếu không hạn chế' },
    { key: 'allowPrint', type: 'bool', default: true, label: 'Cho phép in' },
    { key: 'allowCopy', type: 'bool', default: false, label: 'Cho phép sao chép' },
    { key: 'allowModify', type: 'bool', default: false, label: 'Cho phép sửa' },
  ], run: protect },
  { id: 'unlock', group: 'security', title: 'Mở khoá PDF', description: 'Gỡ mã hoá khi biết mật khẩu.', icon: '🔓', accept: ['.pdf'], multiple: false, status: 'available', options: [
    { key: 'password', type: 'password', required: true, label: 'Mật khẩu hiện có' },
  ], run: unlockTool },
  { id: 'metadata', group: 'security', title: 'Xoá metadata', description: 'Xoá thông tin tác giả, XMP và tệp đính kèm.', icon: '🧹', accept: ['.pdf'], multiple: false, status: 'available', options: [
    { key: 'removeInfo', type: 'bool', default: true, label: 'Xoá thông tin tài liệu (Info)' },
    { key: 'removeXmp', type: 'bool', default: true, label: 'Xoá XMP metadata' },
    { key: 'removeAttachments', type: 'bool', default: true, label: 'Xoá tệp đính kèm' },
  ], run: metadataTool },
];

function listTools() {
  return TOOLS.map(({ run, ...pub }) => ({ ...pub }));
}

function getTools() {
  return TOOLS;
}

module.exports = { listTools, getTools };
