# Thiết kế — Bộ công cụ PDF kiểu iLovePDF (offline, Windows)

**Ngày:** 2026-10-28 · **Trạng thái:** Chờ duyệt · **Phạm vi:** app Electron (`app/`)

Mục tiêu: mở rộng Trình sửa PDF từ một editor đơn lẻ thành bộ công cụ nhiều module, chạy hoàn toàn ngoại tuyến trên Windows x64, theo 3 đợt. Giữ nguyên editor hiện tại và toàn bộ hành vi đã được kiểm thử.

---

## 1. Mục tiêu và không mục tiêu

### 1.1 Mục tiêu đợt 1
- Có màn hình chọn công cụ, xử lý file lớn mà không treo UI, có tiến độ và huỷ.
- 14 công cụ PDF thuần: ghép, tách, xoá/trích trang, tổ chức trang, crop, số trang & header/footer, watermark, PDF → ảnh, ảnh → PDF, HTML → PDF, nén, khoá, mở khoá, xoá metadata.
- Editor hiện tại trở thành một mục riêng: **giữ nguyên toàn bộ chức năng và hành vi** (chữ ký, tẩy/xoá, phiên `.tsp.json`, 8 bộ test cũ), chỉ **thiết kế lại giao diện** cho thống nhất với bộ công cụ.
- Giao diện toàn app (home, tool, editor) dùng chung một hệ thống thiết kế; không chỉ thêm màn hình mới.
- Không ghi đè file gốc mặc định; lỗi hiển thị ngắn gọn bằng tiếng Việt.

### 1.2 Không nằm trong đợt 1
- Chuyển Word/Excel/PowerPoint (đã quyết định hoãn; xem lại ở đợt 3).
- OCR (đợt 2), nén nâng cao theo ảnh nhúng (đợt 2), sửa file hỏng (đợt 2), so sánh PDF (đợt 2), chế độ hàng loạt cho mọi công cụ (đợt 2).
- Ký chứng thư số, PDF/A, scan từ máy scan (đợt 3).
- Cloud, tài khoản, đồng bộ, auto-update, bản mobile, chỉnh sửa text reflow thật trong PDF.
- Không bỏ, không đổi hành vi bất kỳ chức năng hiện có nào; redesign chỉ ở tầng trình bày.

---

## 2. Ràng buộc

| Ràng buộc | Hệ quả thiết kế |
|---|---|
| Offline hoàn toàn | Không gọi mạng ở bất kỳ công cụ nào; HTML → PDF chặn request mạng |
| Windows x64 | Chỉ đóng gói binary win64; build portable + NSIS như hiện tại |
| Không AGPL | Dùng qpdf (Apache-2.0), Tesseract (Apache-2.0), pdf-lib (MIT), pdf.js (Apache-2.0); không Ghostscript/MuPDF/PyMuPDF |
| UI tiếng Việt, tối giản | Thông báo lỗi ngắn, không stack trace; chi tiết trong log |
| Giữ editor ổn định | Không refactor `app.js`; chỉ đổi cách app khởi động và thêm nút quay về |
| Dung lượng | Tăng ~50–70 MB (qpdf ~8 MB; Tesseract + vie/eng ~40 MB ở đợt 2) |

---

## 3. Hiện trạng và lý do tách shell/engine

Hiện tại `renderer/app.js` (1.600 dòng) làm mọi thứ: mở file, render, đối tượng, chữ ký, xuất PDF. File lớn được đọc toàn bộ vào bộ nhớ renderer; không có hàng đợi, tiến độ hay huỷ. Nhét thêm 14 công cụ vào đây sẽ khiến UI treo khi nén/OCR và không thể xử lý hàng loạt.

Thiết kế tách **shell + engine**:
- Shell (renderer) chỉ dựng form, hiển thị tiến độ/kết quả.
- Engine (main process) đọc/ghi file, gọi pdf-lib/qpdf/pdf.js, chạy job.
- Editor vẫn là trang riêng và giữ nguyên logic; phần trình bày được thiết kế lại sau khi engine ổn định.

---

## 4. Kiến trúc

### 4.1 Ranh giới tiến trình

```
┌──────────────────────────── Main process ────────────────────────────┐
│ main.js: cửa sổ, protocol app://, điều hướng home/editor             │
│ suite/registry.js  → manifest 14 công cụ (nguồn duy nhất)            │
│ suite/jobs.js      → queue, temp, tiến độ, huỷ, log                  │
│ suite/pdfops/*     → organize, stamp, convert, optimize, security    │
│ suite/render-worker.js → BrowserWindow ẩn nạp pdf.js, printToPDF     │
│ bin/win32-x64/qpdf.exe, tesseract.exe + tessdata (đợt 2)             │
└───────────────┬──────────────────────────────────────────────────────┘
                │ IPC: chỉ id công cụ + đường dẫn + tuỳ chọn
┌───────────────┴──────────────────────────────────────────────────────┐
│ Renderer                                                             │
│ index.html + suite.js + suite.css  → home & tool (SPA nhỏ)           │
│ editor.html + app.js + styles.css  → editor hiện tại (nguyên trạng)  │
│ worker/render.html                 → trang pdf.js cho render-worker  │
└──────────────────────────────────────────────────────────────────────┘
```

- **Dữ liệu qua IPC là đường dẫn file**, không phải bytes, trừ editor (giữ nguyên luồng bytes hiện tại).
- Render worker là BrowserWindow ẩn, nạp `worker/render.html` + pdf.js có sẵn; main điều phối bằng IPC nội bộ. Dùng cho: thumbnail, PDF → ảnh, raster khi nén, đầu vào OCR (đợt 2), HTML → PDF (`printToPDF` trên cùng cửa sổ ẩn).
- Tool manifest là nguồn duy nhất: UI dựng form từ schema; main validate lại cùng schema trước khi chạy.

### 4.2 Cấu trúc thư mục đề xuất

```
app/
  main.js                     # thêm điều hướng home/editor + IPC suite
  preload.js                  # giữ API cũ, thêm suite API
  suite/
    registry.js               # manifest công cụ
    jobs.js                   # queue, progress, cancel, temp, log
    render-worker.js          # BrowserWindow ẩn + điều phối pdf.js
    pdfops/
      organize.js             # ghép, tách, xoá/trích, tổ chức, crop
      stamp.js                # số trang, header/footer, watermark
      convert.js              # PDF→ảnh, ảnh→PDF, HTML→PDF
      optimize.js             # nén
      security.js             # khoá, mở khoá, metadata
    util/
      paths.js                # resolve binary dev/packaged, đặt tên đầu ra
      spawn.js                # spawn không shell, kill cây tiến trình
      zip.js                  # archiver
      log.js                  # log xoay vòng
  bin/win32-x64/              # qpdf.exe (+ DLL) đợt 1; tesseract.exe + tessdata/ đợt 2
  renderer/
    ui/tokens.css             # MỚI: màu, chữ, khoảng cách, trạng thái dùng chung
    index.html                # MỚI: shell home + tool
    suite.js, suite.css       # MỚI
    editor.html               # MỚI: markup editor (giữ id/class hợp đồng)
    app.js                    # giữ nguyên logic
    styles.css                # viết lại theo token chung (không đổi selector app.js dùng)
    worker/render.html        # MỚI: trang render pdf.js
    vendor/, fonts/           # giữ nguyên
  test/
    suite-unit/*.mjs          # test Node cho pdfops
    suite-e2e.mjs             # Playwright: home → tool → kết quả
    fixtures/                 # PDF sinh tự động (nhiều trang, xoay, mã hoá)
```

Chuyển `index.html` hiện tại thành `editor.html` là thao tác cơ học (markup + modal giữ nguyên). `app.js` vẫn nằm ở `renderer/` nên đường dẫn `vendor/`, `fonts/` không đổi. `index.html` mới chỉ chứa shell.

### 4.3 Khởi động và điều hướng

- Không có file trong argv → `index.html` (home).
- Có file `.pdf` trong argv / mở bằng file association / second-instance → `editor.html` và gửi `open-path` như hiện tại.
- Home → “Chỉnh sửa PDF” → hộp thoại chọn file → main nạp `editor.html` với `pendingFile`.
- Editor → nút “← Trang chủ”: renderer kiểm tra `dirty`, xác nhận nếu cần, rồi gọi IPC `suite:go-home`; main nạp `index.html`.
- Đóng cửa sổ khi editor còn thay đổi: giữ nguyên hộp thoại “Chưa lưu” ở `main.js`.

### 4.4 Hợp đồng IPC mới

| Kênh | Chiều | Dữ liệu |
|---|---|---|
| `suite:tools` | invoke | → danh sách manifest (không kèm hàm runner) |
| `suite:pick-files` | invoke | `{accept, multiple}` → `[path]` |
| `suite:pick-output` | invoke | → `dir \| null` |
| `suite:job-start` | invoke | `{toolId, files, options, outputDir}` → `jobId` |
| `suite:job-cancel` | invoke | `{jobId}` |
| `suite:job-event` | main → renderer | `{jobId, type, ...}` (progress/done/error) |
| `suite:reveal` | invoke | `path` → mở thư mục/thư mục chứa file |
| `suite:settings-get` / `suite:settings-set` | invoke | JSON nhỏ (DPI mặc định, thư mục xuất, OCR) |
| `suite:recents` | invoke | danh sách ≤20 file gần đây |
| `suite:open-editor` | invoke | `path?` → main nạp editor |
| `suite:go-home` | invoke | → main nạp home |
| `suite:health` | invoke | phiên bản qpdf/Tesseract, ngôn ngữ có sẵn |

Mọi kênh kiểm tra `toolId` có trong registry, kiểu dữ liệu và đường dẫn; từ chối sender không phải cửa sổ chính.

### 4.5 Job engine

**Vòng đời:** `queued → running → done | error | cancelled`.

- Queue FIFO, tối đa **2 job song song**; render worker xử lý tuần tự 1 job.
- Mỗi job có thư mục tạm `%TEMP%/TrinhSuaPDF/jobs/<jobId>/`; xoá khi xong/huỷ và khi khởi động (quét thư mục cha).
- Kết quả ghi vào file tạm trong thư mục job, sau đó **move nguyên tử** sang đích; không bao giờ để lại file cụt. Nếu temp và đích khác ổ đĩa (move thất bại), copy sang file tạm cạnh đích, kiểm tra kích thước rồi rename và xoá bản temp.
- Tiến độ: `{phase, current, total, message}` gửi tối đa 10 lần/giây; phase gồm `reading | processing | writing | done`.
- Huỷ: đặt cờ, kill cây tiến trình con (Windows: `taskkill /PID <pid> /T /F`), dừng render worker, xoá đầu ra dở. Mục tiêu dừng ≤2 giây.
- Kiểm tra dung lượng trống (best-effort); nếu ước tính vượt chỗ trống thì cảnh báo trước khi chạy, không chặn cứng.
- Log xoay vòng `userData/logs/tools.log` (≤2 MB × 3 file). Không ghi mật khẩu, không ghi nội dung file.

**Kết quả job:**
```
{ jobId, toolId, outputs: [{path, bytes, pages?}], errors: [{file, code, message}], stats: {ms, inputBytes, outputBytes} }
```
Job có thể thành công một phần: file lỗi nằm trong `errors`, file tốt vẫn có trong `outputs`.

### 4.6 Chọn thư viện theo việc

| Việc | Công cụ | Ghi chú |
|---|---|---|
| Ghép, tách, xoá/trích, sắp xếp, xoay | **qpdf** (`--pages`, `--split-pages`, `--rotate`) | Fallback pdf-lib nếu qpdf lỗi cấu trúc nhẹ |
| Crop | pdf-lib (`setCropBox`/`setMediaBox`) | Chuyển toạ độ theo viewport; test trang xoay |
| Số trang, header/footer, watermark | pdf-lib + `@pdf-lib/fontkit`, nhúng Be Vietnam Pro subset | Dùng chung cách nhúng font với editor |
| PDF → ảnh, thumbnail, raster khi nén | pdf.js trong render worker | DPI, PNG/JPEG |
| Ảnh → PDF | pdf-lib `embedJpg`/`embedPng`; WebP qua render worker | Giữ thứ tự người dùng |
| HTML → PDF | `webContents.printToPDF` | Session riêng, chặn mạng |
| Khoá, mở khoá, repair (đợt 2) | qpdf | AES-256 |
| Xoá metadata | pdf-lib low-level (Info, XMP, EmbeddedFiles) | Báo rõ mục nào xoá được/không |
| OCR (đợt 2) | Tesseract + render worker | TSV → lớp chữ ẩn trên trang gốc |

---

## 5. Hợp đồng công cụ

Mỗi công cụ là một mục trong `suite/registry.js`:

```js
{
  id: 'merge',                    // duy nhất, dùng cho IPC
  group: 'organize',              // organize | stamp | convert | optimize | security
  title: 'Ghép PDF',
  description: 'Ghép nhiều file thành một, đổi được thứ tự.',
  accept: ['.pdf'],
  multiple: true,
  minFiles: 2,
  options: [ /* schema dưới đây */ ],
  run: organize.merge,            // async (ctx) => result
}
```

Kiểu tuỳ chọn hỗ trợ: `range`, `enum`, `int`, `bool`, `text`, `color`, `password`, `imageFile`, `pageSelection` (lưới thumbnail). UI sinh control từ schema; main validate độc lập. Không cho phép tuỳ chọn lạ.

`ctx` truyền cho runner: `{ jobId, files, options, outputDir, tempDir, signal, progress, render, log }`. Runner không tự mở hộp thoại, không đọc DOM.

---

## 6. Đặc tả 14 công cụ đợt 1

Quy ước chung:
- Khoảng trang 1-based, cú pháp `1-3,5,8-` (xem Phụ lục A).
- Mọi thao tác làm thay đổi file sẽ **vô hiệu chữ ký số hiện có** — hiện cảnh báo một lần trong kết quả.
- PDF mã hoá: trả `PASSWORD_REQUIRED`; UI hỏi mật khẩu rồi chạy lại, không tự bỏ qua.
- Không ghi đè file gốc mặc định.

### 6.1 Tổ chức

| id | Công cụ | Tuỳ chọn | Đầu ra / biên |
|---|---|---|---|
| `merge` | Ghép PDF | danh sách file (≥2, đổi thứ tự) | 1 PDF; giữ nguyên toàn bộ trang của từng file |
| `split` | Tách PDF | chế độ `ranges` \| `every-n` \| `each-page`; N; khoảng | Thư mục `base-tach/` + tuỳ chọn ZIP; mỗi phần một PDF |
| `pages` | Xoá & trích trang | chế độ `delete` \| `extract`; lưới chọn trang + khoảng | 1 PDF; trích theo đúng thứ tự nhập, cho phép lặp trang |
| `organize` | Tổ chức trang | kéo đổi thứ tự, xoay từng trang 90/180/270, nhân bản, chèn trang trắng | 1 PDF; lưới thumbnail |
| `crop` | Crop PDF | khung cắt trên preview; áp cho trang hiện tại / khoảng / tất cả | 1 PDF; CropBox + MediaBox; test 0/90/180/270 |

Ghi chú:
- Ghép bằng qpdf giữ nội dung trang; **form/link có thể mất** — ghi trong README và cảnh báo sau khi chạy nếu file gốc có AcroForm.
- `split` dùng một lệnh qpdf cho mỗi phần để hỗ trợ khoảng không đều; đánh số `base-01.pdf`, `base-02.pdf`…
- `pages` thao tác trên bản sao; nếu xoá hết trang → `NO_PAGES`, không tạo file rỗng.
- `organize` chèn trang trắng bằng pdf-lib; nhân bản trang bằng qpdf `--pages` lặp trang.
- `crop` lưu hộp theo đơn vị điểm PDF; UI hiển thị theo toạ độ màn hình đã xoay.

### 6.2 Đánh dấu

| id | Công cụ | Tuỳ chọn | Đầu ra / biên |
|---|---|---|---|
| `stamp` | Số trang & header/footer | 3 ô trái/giữa/phải; placeholder `{page}`, `{total}`, `{date}`; phông Be Vietnam Pro; cỡ; màu; lề; số bắt đầu; khoảng trang | 1 PDF; mặc định đánh số `Trang {page}/{total}` ở giữa dưới |
| `watermark` | Watermark | chữ hoặc ảnh; phông/cỡ/màu; độ mờ 0–100%; xoay; vị trí giữa hoặc lát kín; lề; khoảng trang | 1 PDF; watermark nằm trên nội dung (không hỗ trợ “dưới nội dung” ở đợt 1) |

- Nhúng phông subset; nếu thiếu glyph tiếng Việt thì báo `MISSING_GLYPHS` và liệt kê ký tự (dùng lại `fonts-coverage`).
- Watermark ảnh: nhận PNG/JPG; độ mờ áp bằng ExtGState.
- Vị trí tính theo MediaBox hiện tại; trang xoay dùng cùng phép biến đổi với editor, có test.

### 6.3 Chuyển đổi

| id | Công cụ | Tuỳ chọn | Đầu ra / biên |
|---|---|---|---|
| `pdf-images` | PDF → ảnh | JPG/PNG; DPI 72–600 (mặc định 150); chất lượng JPEG; khoảng trang | `base-anh/` + tuỳ chọn ZIP; `base-01.jpg`… |
| `images-pdf` | Ảnh → PDF | danh sách ảnh (đổi thứ tự); khổ A4/A3/Letter/tự động; dọc/ngang; lề mm; vừa khung | 1 PDF; ảnh WebP được chuyển PNG qua render worker |
| `html-pdf` | HTML → PDF | file `.html`; khổ; lề; hướng; in nền; tỉ lệ | 1 PDF; chặn mọi request mạng |

- `pdf-images` render tuần tự từng trang, trả tiến độ theo trang; ảnh lớn giới hạn cạnh tối đa 10.000 px.
- Ảnh → PDF giữ đúng thứ tự; ảnh trong suốt đặt trên nền trắng.
- HTML → PDF: nạp file local trong session ẩn; `webRequest.onBeforeRequest` chặn `http(s)/ws(s)`; tài nguyên tương đối trong cùng thư mục được phép. Nếu HTML có tham chiếu mạng → kết quả thiếu tài nguyên, ghi cảnh báo trong report.

### 6.4 Tối ưu

| id | Công cụ | Tuỳ chọn | Đầu ra / biên |
|---|---|---|---|
| `compress` | Nén PDF | `lossless` (qpdf) hoặc `raster` (DPI, PNG/JPEG, chất lượng); khoảng trang cho raster | 1 PDF; hiện dung lượng trước/sau; raster cảnh báo mất lớp chữ trên trang bị raster |

- Lossless dùng `--object-streams=generate --recompress-flate --compression-level=9`; **không hứa giảm nhiều** — hiện đúng số đo.
- Raster dùng lại pipeline `renderMaskedPage` ý tưởng từ editor nhưng không có mask; chỉ áp cho trang được chọn, các trang khác giữ nguyên.
- Không tự động chọn chế độ thay người dùng; mặc định lossless.

### 6.5 Bảo mật

| id | Công cụ | Tuỳ chọn | Đầu ra / biên |
|---|---|---|---|
| `protect` | Khoá PDF | mật khẩu mở (có thể để trống = chỉ chủ), mật khẩu chủ; cho phép in/sao chép/sửa/chú thích; AES-256 | 1 PDF; cảnh báo nếu mật khẩu mở < 6 ký tự |
| `unlock` | Mở khoá PDF | mật khẩu hiện có | 1 PDF không mã hoá; sai mật khẩu → `PASSWORD_INVALID` |
| `metadata` | Xoá metadata | chọn xoá Info/XMP/đính kèm (mặc định cả ba); xem trước danh sách | 1 PDF; report liệt kê mục đã xoá và mục còn lại |

- qpdf nhận mật khẩu qua file tham số tạm (`@file` / `--password-file`), không đưa lên dòng lệnh, không ghi log; xoá file ngay sau khi chạy.
- `metadata` không đụng nội dung trang; nếu file có chữ ký số, cảnh báo chữ ký sẽ mất hiệu lực.
- `unlock` không phải công cụ bẻ khoá: bắt buộc biết mật khẩu.

### 6.6 Editor

Giữ nguyên **toàn bộ tính năng, phím tắt, luồng chữ ký/phiên và hợp đồng DOM** (`id`, `data-*`, class mà `app.js` và test dùng). Thay đổi:
- Chuyển markup sang `editor.html`.
- Thiết kế lại giao diện theo hệ thống chung: thanh trên cùng (quay về, tên file, hoàn tác/làm lại, lưu, zoom, trạng thái), rail công cụ bên trái, bảng thuộc tính bên phải, thumbnail thu gọn được, canvas ở giữa.
- Thêm nút “← Trang chủ” có kiểm tra thay đổi chưa lưu.
- Không thêm “Xoá metadata khi lưu” ở đợt 1 (để tránh đổi hành vi phiên); người dùng dùng công cụ `metadata` sau khi lưu.
- Không đổi logic render/xuất/chữ ký/phiên; chỉ thêm hook điều hướng “Trang chủ”.

---

## 7. Giao diện

### 7.0 Định hướng thiết kế lại

- Giữ toàn bộ chức năng hiện có; redesign là thay đổi trình bày, không làm lại logic.
- Một hệ thống chung cho home, tool và editor: token màu/chữ/khoảng cách, component (nút, ô nhập, thẻ, panel, progress, toast), trạng thái hover/active/disabled/focus.
- Tối giản, tiếng Việt, mật độ vừa phải; không gradient trang trí, không icon ngoài bộ đang dùng; mỗi màn hình có một hành động chính rõ ràng.
- Khung chung: rail trái (logo, Trang chủ, nhóm công cụ, Cài đặt), vùng nội dung; top bar đổi theo ngữ cảnh (home/tool/editor).
- Cửa sổ tối thiểu 900×600; màn hẹp thì panel phải thu thành drawer, thumbnail ẩn được.
- Nhóm “Sắp có” trên home cho OCR, nén nâng cao, so sánh, Office, PDF/A, ký số — disabled kèm nhãn đợt, không giả vờ đã có.
- Giữ token hiện tại làm gốc: `--blue #0b5cd5`, Be Vietnam Pro, nền `#e9edf3`; tinh chỉnh thang chữ, khoảng cách, bo góc và trạng thái.

### 7.1 Home (`index.html`)

- Rail trái: Trang chủ; nhóm Tổ chức · Đánh dấu · Chuyển đổi · Tối ưu · Bảo mật · Soạn thảo; Cài đặt ở chân rail.
- Top bar: tên app, ô tìm công cụ, nút “Chỉnh sửa PDF” primary.
- Lưới thẻ công cụ: icon, tên, mô tả một dòng; thẻ “Chỉnh sửa PDF” nổi bật.
- Vùng kéo-thả file: thả PDF → gợi ý công cụ phù hợp; thả ảnh → `images-pdf`; thả nhiều PDF → `merge`.
- “File gần đây” (≤20): mở bằng editor hoặc mở thư mục; kiểm tra tồn tại khi hiển thị.
- Trạng thái engine: qpdf/Tesseract sẵn sàng hay thiếu (chỉ hiện khi có vấn đề).

### 7.2 Trang công cụ

- Bố cục hai cột: trái là file/thumbnail/preview, phải là panel tuỳ chọn; dưới cùng là thanh hành động.
- Một màn hình 3 bước: **Chọn file → Tuỳ chọn → Kết quả**.
- Danh sách file có đổi thứ tự, xoá, thêm; hiện số trang/kích thước sau khi đọc metadata.
- Tuỳ chọn dựng từ schema; công cụ chọn trang có lưới thumbnail (render worker, tải lười theo cuộn) và ô nhập khoảng trang, hai cách đồng bộ nhau.
- Nút “Chạy” disabled đến khi dữ liệu hợp lệ; hiện tóm tắt “Sẽ xử lý N trang / M file”.
- Trong khi chạy: thanh tiến độ, tên file đang xử lý, nút Huỷ; UI vẫn cuộn được.
- Kết quả: dung lượng trước/sau, số file, lỗi từng file; nút “Mở thư mục”, “Chạy lại”, “Làm công cụ khác”.

### 7.3 Editor redesign (giữ nguyên chức năng)

- Top bar: “← Trang chủ”, tên file + trạng thái phiên, Hoàn tác/Làm lại, Lưu/Lưu thành, Zoom, trạng thái.
- Rail trái: Chọn · Chữ · Tẩy xoá · Chữ ký · Ảnh · Bút · Dạ quang; phím tắt V/T/E/P/H giữ nguyên.
- Panel phải: thuộc tính theo công cụ/đối tượng đang chọn (phông, cỡ, màu, nét, kiểu xoá, nền che, xoay ảnh); thay cho dải `.ctx` hai hàng hiện tại.
- Giữa: canvas trang; thumbnail chuyển thành panel trái thu gọn/mở, không chiếm chỗ cố định.
- Giữ nguyên **id, data-*, class hợp đồng** mà `app.js` và test dùng; chỉ đổi cấu trúc bao ngoài và CSS. Không đổi logic render/xuất/chữ ký/phiên.
- Giữ các selector `app.js` truy vấn trực tiếp: `header`, `.ctx .sec`, `#side`, `#thumbs`, `#viewer`, `#pages`, `body.tool-*`; nếu buộc phải đổi thì cập nhật `app.js` và test trong cùng commit.
- Modal chữ ký và Lưu dùng lại component chung (dialog, tab, form, progress); nội dung và luồng giữ nguyên.
- Trạng thái rỗng, toast, busy, disabled dùng chung với tool pages.

### 7.4 Thành phần và trạng thái

- Component: `button` (primary/ghost/icon), `field`, `select`, `range`, `card`, `panel`, `tabs`, `dialog`, `progress`, `toast`, `empty`.
- Trạng thái bắt buộc: hover, active, disabled, focus-visible; chữ không nhỏ hơn 12 px; vùng bấm ≥32 px.
- Chuyển động nhẹ 120–180 ms; không animation khi `prefers-reduced-motion`.
- Ảnh chụp nghiệm thu ở 1400×900 và 900×600 cho home, tool, editor.

### 7.5 Cài đặt nhẹ

Lưu JSON trong `userData/settings.json`: thư mục xuất mặc định, DPI mặc định (150), chế độ nén mặc định (lossless), ngôn ngữ OCR (đợt 2), số job song song (1–2). Không thêm thư viện.

---

## 8. Bảo mật

- Giữ `contextIsolation: true`, `nodeIntegration: false`; preload chỉ phơi hàm cụ thể.
- `toolId` phải có trong registry; tuỳ chọn validate theo schema; từ chối đường dẫn không do người dùng chọn (hộp thoại/kéo-thả).
- `spawn` bằng mảng tham số, `shell: false`; không nối chuỗi lệnh. Mật khẩu qua file tạm, không log.
- Tên đầu ra lấy từ `basename` của file nguồn; không cho ghi vào thư mục hệ thống ngoài lựa chọn của người dùng.
- HTML → PDF: session `partition` tạm, chặn `http(s)/ws(s)`, không mở devtools, không cấp quyền.
- Không telemetry, không request mạng từ main/renderer ngoài app://; giữ CSP hiện tại cho editor và áp dụng cho shell.
- Temp: mỗi job một thư mục; xoá khi xong/huỷ/khởi động; không dùng temp chung với editor.

---

## 9. Xử lý lỗi

### 9.1 Mã lỗi

| Mã | Ý nghĩa | UI |
|---|---|---|
| `PASSWORD_REQUIRED` | PDF cần mật khẩu | Hiện ô nhập mật khẩu, chạy lại |
| `PASSWORD_INVALID` | Sai mật khẩu | “Mật khẩu không đúng. Thử lại.” |
| `INVALID_FILE` | Không phải PDF/ảnh hợp lệ | “File không hợp lệ.” |
| `CORRUPT_FILE` | Cấu trúc PDF hỏng | Gợi ý dùng công cụ sửa (đợt 2) |
| `NO_PAGES` | Không còn trang sau thao tác | “Không thể xoá hết các trang.” |
| `INVALID_RANGE` | Khoảng trang sai | Chỉ rõ khoảng sai |
| `OUTPUT_EXISTS` | Đích đã tồn tại, chưa bật ghi đè | Tự thêm ` (2)` thay vì lỗi |
| `DISK_FULL` | Hết chỗ | “Không đủ dung lượng.” |
| `BINARY_MISSING` | Thiếu qpdf/Tesseract | Thông báo chặn + “Thử lại” |
| `CANCELLED` | Người dùng huỷ | Không hiện lỗi, chỉ trạng thái |
| `MISSING_GLYPHS` | Phông thiếu ký tự | Cảnh báo trong kết quả |
| `INTERNAL` | Lỗi không lường trước | “Không xử lý được. Thử lại.” + log |

### 9.2 Nguyên tắc hiển thị
- Thông báo ngắn, tiếng Việt, không mã lỗi/stack trace trên UI; chi tiết ở log.
- Lỗi theo file hiện trong danh sách kết quả; lỗi chặn cả job hiện ở đầu trang kèm “Thử lại”.
- Không tự thử lại vô hạn; mỗi lần người dùng bấm chạy là một job mới.

---

## 10. Kiểm thử và nghiệm thu

### 10.1 Unit (Node, không cần Electron)
Đặt trong `test/suite-unit/`, dùng `node:assert`, chạy `npm run test:tools`.
- Fixture sinh tự động: PDF 10/5/7 trang, PDF xoay 0/90/180/270 (dùng lại `test/rotation.mjs`), PDF mã hoá (qpdf), ảnh PNG/JPG/WebP, HTML local có tài nguyên tương đối và một URL mạng.
- Ghép: đúng 22 trang, đúng thứ tự, mở lại được.
- Tách: `ranges` `1-3,5` → 2 file đúng trang; `each-page` → N file; `every-n` → đúng số phần.
- Xoá/trích: thứ tự trích, cho phép lặp, xoá hết → `NO_PAGES`.
- Organize: đổi thứ tự, xoay, nhân bản, chèn trắng → số trang và chiều xoay đúng.
- Crop: CropBox/MediaBox đúng trên cả 4 hướng xoay.
- Stamp/watermark: vị trí và glyph tiếng Việt; watermark ảnh độ mờ; trang xoay.
- PDF → ảnh: số ảnh, kích thước theo DPI, JPEG/PNG hợp lệ (đọc magic bytes).
- Ảnh → PDF: số trang, thứ tự, khổ giấy, lề.
- HTML → PDF: số trang > 0; không có request mạng (session log).
- Nén: lossless giữ nguyên nội dung/trang; raster giảm dung lượng và mất text layer trên trang raster (kiểm tra bằng pdf.js).
- Khoá/mở khoá: qpdf `--show-encryption` xác nhận AES-256; mở đúng mật khẩu; sai → `PASSWORD_INVALID`.
- Metadata: Info rỗng, XMP không còn, không còn EmbeddedFiles; báo cáo khớp.
- Đặt tên: trùng đích → ` (2)`; không ghi đè mặc định.

### 10.2 Integration (Playwright + Electron)
`test/suite-e2e.mjs`: home → mở công cụ → chọn fixture → chạy → đọc đầu ra; test huỷ job (dừng ≤2 giây), mật khẩu sai, file hỏng, trùng tên, mở editor từ home.
- Giữ xanh toàn bộ 8 bộ test editor hiện có.
- Mở rộng `test/smoke-asar.mjs`: chạy một job từ bản đóng gói, xác nhận qpdf/Tesseract tìm thấy qua `process.resourcesPath`.

### 10.3 Tiêu chí nghiệm thu đợt 1
1. 14 công cụ chạy được từ UI trên fixture, kết quả mở được bằng Chrome/Acrobat.
2. Không treo UI khi xử lý PDF 100 trang; huỷ dừng ≤2 giây.
3. Không ghi đè file gốc khi chưa xác nhận; không để lại file cụt/temp sau khi xong.
4. Xoá metadata: không còn Title/Author/Subject/Producer/XMP/đính kèm (kiểm tra raw).
5. Khoá AES-256 mở được bằng mật khẩu; mở khoá đúng mật khẩu.
6. Watermark/số trang đúng trên trang xoay 90/270.
7. HTML → PDF không phát sinh request mạng.
8. Bản đóng gói portable và NSIS chạy được công cụ đầu tiên.
9. 8 bộ test editor cũ vẫn xanh mà **không sửa selector**.
10. Toàn bộ chức năng editor hiện có vẫn hoạt động sau redesign: mở/kéo-thả, zoom/thumbnail, xoá trang, chọn/ghim phông, chữ ký (vẽ/ảnh/thư viện/đặt góc), tẩy/xoá 3 kiểu, bám dòng, bút/dạ quang, phiên, hoàn tác/làm lại, nhân bản, lưu/lưu thành, phím tắt.
11. Có ảnh chụp home/tool/editor ở 1400×900 và 900×600; không mất control nào so với danh sách chức năng hiện tại.

---

## 11. Đóng gói, giấy phép, phiên bản

- `electron-builder.extraResources`: `bin/` → `resources/bin/`; qpdf.exe + DLL, tesseract.exe + `tessdata/vie.traineddata`, `eng.traineddata` (đợt 2).
- Resolve binary: dev → `app/bin/win32-x64/…`; packaged → `process.resourcesPath/bin/win32-x64/…`. `asar: true` giữ nguyên; binary nằm ngoài asar.
- Thêm `THIRD-PARTY-NOTICES.txt`: qpdf (Apache-2.0), Tesseract (Apache-2.0), tessdata (Apache-2.0), pdf-lib (MIT), pdf.js (Apache-2.0), fontkit (MIT), archiver (MIT).
- `suite:health` kiểm tra `qpdf --version` lúc khởi động; `tesseract --version` chỉ kiểm tra từ đợt 2 (khi binary được đóng gói). Lỗi ghi log, UI chỉ báo khi người dùng mở công cụ liên quan.
- Phiên bản **2.0.0**; README viết lại: bộ công cụ, giới hạn (form/link khi ghép, nén lossless giảm ít, chữ ký số mất hiệu lực khi sửa), giấy phép binary, hướng dẫn test.
- `.exe` vẫn chưa ký số — SmartScreen có thể cảnh báo; ghi trong README.
- CI tùy chọn: GitHub Actions `windows-latest` chạy `test:tools` + `test:smoke`; E2E chạy thủ công trước phát hành.

---

## 12. Lộ trình

### Đợt 1 (spec này)
1. **M1 — Khung + design system:** tách `editor.html`, shell home, token/component dùng chung, preload/IPC, registry, job queue, render worker; 3 công cụ mẫu: `merge`, `pdf-images`, `protect`. Editor tạm giữ giao diện cũ trong mốc này.
2. **M2 — 11 công cụ còn lại:** mỗi công cụ kèm unit test; áp component system cho tool pages; ưu tiên nhóm tổ chức → đánh dấu → chuyển đổi → tối ưu/bảo mật.
3. **M3 — Redesign editor + đóng gói:** thiết kế lại UI editor (thuần trình bày, giữ hợp đồng DOM), chạy lại 8 bộ test cũ, E2E, smoke asar, ảnh chụp, README, version 2.0.0, build portable + NSIS.

Mỗi mốc chạy toàn bộ test cũ + mới trước khi sang mốc kế.

### Đợt 2
OCR vie+eng (TSV → lớp chữ ẩn trên trang gốc), nén nâng cao (nén lại ảnh nhúng giữ text), repair qpdf, so sánh văn bản/ảnh, batch cho mọi công cụ.

### Đợt 3
Ký chứng thư số PKCS#12, PDF/A (cân nhắc Ghostscript AGPL hoặc công cụ ngoài), nhóm Office (quyết định lại: LibreOffice nhúng / Office có sẵn / bỏ), scan.

---

## 13. Rủi ro và giảm thiểu

| Rủi ro | Giảm thiểu |
|---|---|
| Ghép/tách làm mất form, link, outline | Test fixture có form/link; cảnh báo trong kết quả; ghi README; fallback pdf-lib |
| Crop lệch trên trang xoay | Dùng chung phép biến đổi với editor; test 0/90/180/270 |
| Watermark/số trang thiếu dấu tiếng Việt | Nhúng Be Vietnam Pro subset; kiểm tra glyph trước khi chạy |
| HTML → PDF lộ request mạng | Session chặn mạng + test webRequest; chỉ nhận file local |
| Mật khẩu lộ qua tiến trình/log | File tham số tạm, xoá ngay, không log |
| qpdf/Tesseract bị AV chặn hoặc thiếu DLL | Đóng gói đủ DLL, test bản asar, health check + thông báo rõ |
| Binary bên thứ ba không rõ nguồn gốc | Chỉ tải từ bản phát hành chính thức, ghi URL + SHA-256 vào `THIRD-PARTY-NOTICES` |
| Dung lượng app tăng | Chỉ qpdf ở đợt 1; Tesseract đợt 2; hiển thị dung lượng trong README |
| Job treo do tiến trình con | Kill cây tiến trình, timeout mềm theo job, nút Huỷ |
| File cụt khi lỗi giữa chừng | Ghi temp rồi move nguyên tử; dọn temp khi khởi động |
| PDF/A, Office, ký số bị hiểu là “có trong đợt 1” | Ghi rõ trong README và UI (nhóm “Sắp có”) |
| Redesign editor làm vỡ selector/test hoặc mất chức năng | Giữ id/class hợp đồng; checklist từng control hiện có; chạy 8 bộ test sau mỗi commit UI; ảnh chụp trước/sau |
| 14 công cụ làm home quá tải | Nhóm + tìm kiếm + nhóm “Sắp có” thu gọn; mỗi thẻ chỉ một dòng mô tả |

---

## 14. Quyết định hoãn

- Office: hoãn sang đợt 3; lúc đó chọn giữa LibreOffice nhúng (~350 MB), dùng Office/LibreOffice có sẵn, hoặc bỏ.
- PDF/A: cần Ghostscript (AGPL) hoặc dịch vụ ngoài; chưa chốt.
- Ký chứng thư số: chưa chốt UX (chọn PFX, PIN, timestamp TSA) và yêu cầu pháp lý.
- OCR: chưa chốt `fast` vs `best`, có deskew/despeckle hay không.
- Xem trước kết quả trước khi lưu cho công cụ nặng (nén/OCR): cân nhắc đợt 2.

---

## Phụ lục A — Cú pháp khoảng trang

- 1-based; `1-3,5,8-` = 1,2,3,5,8→hết.
- Khoảng trống = tất cả trang.
- Trang lặp được phép khi trích (`1,1,2`), không có ý nghĩa khi xoá (bỏ qua trùng).
- Giới hạn trong `[1, số trang]`; vượt → `INVALID_RANGE` kèm khoảng sai.
- UI hiện “Sẽ xử lý N trang” ngay khi nhập.

## Phụ lục B — Đặt tên đầu ra

- Một file: `‹base›-‹mã›.pdf`; mã: `ghep`, `xoa-trang`, `trich-trang`, `to-chuc`, `crop`, `so-trang`, `watermark`, `nen`, `khoa`, `mo-khoa`, `xoa-metadata`, `html-pdf`.
- Nhiều file: thư mục `‹base›-tach/` hoặc `‹base›-anh/`; file `‹base›-01.pdf`, `‹base›-02.pdf`…
- Trùng đích: thêm ` (2)`, ` (3)`…; không ghi đè trừ khi bật “Ghi đè” và xác nhận.
- Mặc định cùng thư mục file nguồn; đổi được trong tuỳ chọn hoặc Cài đặt.

## Phụ lục C — Bố cục temp và log

```
%TEMP%/TrinhSuaPDF/jobs/<jobId>/
  in/            # bản sao/tệp làm việc nếu cần
  out/           # đầu ra tạm trước khi move
  args/          # file tham số qpdf chứa mật khẩu (xoá ngay sau khi dùng)
userData/logs/tools.log        # xoay vòng ≤2 MB × 3
userData/settings.json
userData/recents.json
```
