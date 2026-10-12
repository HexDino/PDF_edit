# Trình sửa PDF (TrinhSuaPDF)

Ứng dụng desktop **Electron** (giao diện tiếng Việt) để chỉnh sửa PDF thường và PDF scan: thêm chữ viết tay, tẩy/che nội dung, bút/bút dạ quang, chữ ký vẽ hoặc nhập ảnh, xem thumbnail trang. Chạy **ngoại tuyến** — thư viện PDF và phông chữ được đóng gói sẵn trong app.

Phiên bản trình duyệt một file (CDN) nằm ở [`web/index.html`](web/index.html).

![Công cụ tẩy/che trên PDF](docs/screenshot-erase-tool.png)

![Đặt chữ ký lên trang](docs/screenshot-signature-placed.png)

## Tính năng chính

- Mở PDF scan nhiều trang hoặc PDF chữ thường; zoom, cuộn, thumbnail bên phải.
- **17 phông viết tay** hỗ trợ tiếng Việt (Google Fonts, giấy phép OFL) + **Be Vietnam Pro** cho giao diện.
- Công cụ **tẩy/che**: che bằng hình chữ nhật, gõ chữ thay thế; tùy chọn **xóa hẳn** khi lưu (flatten trang thành ảnh ~300 dpi).
- **Chữ ký**: vẽ trên pad, nhập ảnh (tách nền), thư viện lưu tại `%APPDATA%\TrinhSuaPDF\signatures` (Windows) hoặc tương đương trên Linux/macOS.
- Bút, bút dạ quang; xuất PDF qua pdf-lib + fontkit.
- Đóng gói Windows x64: file **portable** và **NSIS installer** (electron-builder).

## Cấu trúc thư mục

```
app/          # Ứng dụng Electron (main.js, preload.js, renderer/, build/, test/)
web/          # Bản web một file (index.html)
docs/         # Ảnh minh họa cho README
```

## Chạy trong môi trường phát triển

Yêu cầu: **Node.js 18+**.

```bash
cd app
npm install
npm start
```

Mở PDF qua menu **Mở** hoặc kéo thả; lưu bằng **Ctrl+S** / **Ctrl+Shift+S** (tùy chọn xóa hẳn).

## Build file `.exe` cho Windows

Trong thư mục `app/`:

```bash
npm install
npm run build
```

Kết quả trong `app/dist/` (portable và bộ cài NSIS). Trên **Linux**, build Windows cần thêm **Wine** (và thường cả wine32/i386) để electron-builder chạy trình cài/gói Win:

```bash
# Ví trên Debian/Ubuntu (tùy distro)
sudo dpkg --add-architecture i386   # nếu cần
sudo apt update && sudo apt install -y wine wine32
cd app && npm run build
```

## Kiểm thử

Cài dependency cho test (Playwright **core**, không tải trình duyệt):

```bash
cd app/test/tools && npm install
cd ../..
```

- **Smoke test** (headless, cần `xvfb` trên Linux):

  ```bash
  cd app
  xvfb-run -a npm test
  ```

- **E2E đầy đủ** (tương tác UI, lưu PDF mẫu vào `test/out/`):

  ```bash
  xvfb-run -a npm run test:e2e
  xvfb-run -a npm run test:overlay
  ```

## Giấy phép phông chữ

Các phông viết tay và **Be Vietnam Pro** lấy từ [Google Fonts](https://fonts.google.com/), giấy phép **[SIL Open Font License (OFL)](https://scripts.sil.org/OFL)**. File `.ttf` nằm trong `app/renderer/fonts/`. Phông chuẩn PDF.js (Foxit/Liberation) có LICENSE kèm trong `app/renderer/vendor/standard_fonts/`.

## Hạn chế đã biết

- File `.exe` **chưa ký số** — Windows SmartScreen có thể cảnh báo khi chạy lần đầu.
- Khi bật **xóa hẳn** / flatten, trang PDF trở thành **ảnh** (mất lớp chữ vector gốc trên vùng đã flatten).
- **Không xoay trang** PDF.
- **Không hỗ trợ** PDF có mật khẩu / mã hóa.

## Tác giả

© 2026 Nguyễn Thanh Hưng — mã nguồn trong repo [HexDino/PDF_edit](https://github.com/HexDino/PDF_edit).
