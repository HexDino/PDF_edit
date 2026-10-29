const { merge } = require('./pdfops/organize');
const { pdfImages } = require('./pdfops/convert');
const { protect } = require('./pdfops/security');

const TOOLS = [
  { id: 'merge', group: 'organize', title: 'Ghép PDF', description: 'Ghép nhiều file thành một, đổi được thứ tự.', icon: '⧉', accept: ['.pdf'], multiple: true, minFiles: 2, status: 'available', options: [], run: merge },
  { id: 'split', group: 'organize', title: 'Tách PDF', description: 'Tách theo khoảng trang hoặc từng trang.', icon: '✂', accept: ['.pdf'], multiple: false, status: 'planned', options: [] },
  { id: 'pages', group: 'organize', title: 'Xoá & trích trang', description: 'Chọn trang để xoá hoặc trích thành file mới.', icon: '▤', accept: ['.pdf'], multiple: false, status: 'planned', options: [] },
  { id: 'organize', group: 'organize', title: 'Tổ chức trang', description: 'Đổi thứ tự, xoay, nhân bản, chèn trang trắng.', icon: '⇅', accept: ['.pdf'], multiple: false, status: 'planned', options: [] },
  { id: 'crop', group: 'organize', title: 'Crop PDF', description: 'Cắt lề trang theo khung tuỳ chọn.', icon: '⌗', accept: ['.pdf'], multiple: false, status: 'planned', options: [] },
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
  { id: 'unlock', group: 'security', title: 'Mở khoá PDF', description: 'Gỡ mã hoá khi biết mật khẩu.', icon: '🔓', accept: ['.pdf'], multiple: false, status: 'planned', options: [] },
  { id: 'metadata', group: 'security', title: 'Xoá metadata', description: 'Xoá thông tin tác giả, XMP và tệp đính kèm.', icon: '🧹', accept: ['.pdf'], multiple: false, status: 'planned', options: [] },
];

function listTools() {
  return TOOLS.map(({ run, ...pub }) => ({ ...pub }));
}

function getTools() {
  return TOOLS;
}

module.exports = { listTools, getTools };
