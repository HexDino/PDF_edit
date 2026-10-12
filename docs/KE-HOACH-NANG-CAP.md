# Kế hoạch nâng cấp — Trình sửa PDF

**Ngày lập:** 2026-10-12 · **Nhánh đề xuất:** `feature/fonts-erase-signature`
**Phạm vi:** cả app Electron (`app/`) và bản web một file (`web/index.html`).

Mục tiêu: (1) đa dạng hoá font chữ, (2) nâng cấp công cụ tẩy/xoá, (3) sửa các lỗi phần chữ ký.

---

## 1. Hiện trạng & phát hiện

### 1.1 Font chữ
| # | Vấn đề | Vị trí |
|---|---|---|
| F1 | 17 font chia 3 nhóm, **toàn bộ đều là font "tay"**; thiếu font in/serif/mono/typewriter | `app.js` L11–29 |
| F2 | Nhúng font bằng `subset:false` → nhúng nguyên file, thêm font sẽ làm PDF phình to | `app.js` L758 |
| F3 | Danh sách nhóm hardcode `[G_NEAT, G_SIGN, G_DOC]`; số font hardcode `"17 phông"` | `app.js` L78, L859 |
| F4 | Bộ chọn font: không tìm kiếm, không đổi chữ xem trước, không ghim font hay dùng | `buildPicker` L76–89 |
| F5 | `openPicker()` tải **tất cả** font cùng lúc (mỗi font 100–300KB) → nặng khi thêm font | `app.js` L90 |
| F6 | Không cảnh báo font thiếu glyph tiếng Việt; chỉ báo *sau khi lưu* | `app.js` L769, L828 |
| F7 | **Rủi ro thực tế:** tag `vietnamese` của Google Fonts không đảm bảo đủ dấu chồng. VD Caveat đạt 34/256 → chưa rõ 17 font hiện có đủ 134 ký tự tiếng Việt hay không | cần audit |

### 1.2 Tẩy/xoá
| # | Vấn đề | Vị trí |
|---|---|---|
| E1 | **Chỉ có 1 kiểu: hình chữ nhật.** Không cọ xoá tự do, không lasso | `drawRect` L365–382 |
| E2 | Tô **một màu phẳng** lấy bằng trung vị vùng sáng → hỏng với nền màu/gradient/scan xám | `sampleRing` L285–305 |
| E3 | "Xoá hẳn" flatten **cả trang thành JPEG q=0.9 @300dpi** → mất nét quanh chữ, file nặng, mất khả năng chọn/tìm chữ | `flattenPage` L722–744 |
| E4 | Không bám dòng chữ → dễ che hụt chân chữ hoặc che thừa | — |
| E5 | Không xem trước kết quả, không ước lượng dung lượng trước khi lưu | `save` L799–810 |

### 1.3 Chữ ký — 4 lỗi cụ thể tìm được trong code
| # | Lỗi | Vị trí | Hệ quả |
|---|---|---|---|
| S1 | `pad.strokes` **không bao giờ được xoá sau khi đặt chữ ký** (chỉ nút "Xoá hết" xoá) | `useSignature` L704–717; chỉ có ở `padClear` L632 | Mở lại hộp thoại vẫn còn chữ ký cũ → đặt nhầm/chồng |
| S2 | `recolor()` ghi đè RGB **toàn bộ** ảnh, giữ alpha | `recolor` L578–583 | Với **JPG (không có alpha)** → chữ ký biến thành **khối màu đặc** |
| S3 | Mỗi lần đặt chữ ký đều `libApi.save()` nếu tick "Lưu vào thư viện" | `useSignature` L714 | **Thư viện đầy bản trùng lặp**, không có chống trùng |
| S4 | `libSel`, `sigOut`, `sigSrcImg` không reset khi mở hộp thoại; pad vẽ live dùng `drawStroke(from)` incremental còn `trimCanvas` đọc canvas → preview có thể **khác** kết quả đặt | `openSig` L590, `drawStroke` L604–613 | Chọn nhầm chữ ký cũ; chữ ký đặt ra lệch/méo so với nét vẽ |
| S5 | Ngưỡng cắt sát cố định `trimCanvas(c,40,8)` + `padPx` tính bằng px canvas | `processSigImage` L680, `trimCanvas` L635 | Chữ ký mảnh bị **cắt mất nét**; tách nền còn vệt xám |
| S6 | Guard bàn phím: `Ctrl+S` xử lý **trước** khi kiểm tra modal; `Escape` chỉ đóng `sigModal`, không reset | `keydown` L839–855 | Lưu ngoài ý muốn khi đang mở hộp thoại chữ ký |
| S7 | `imgStore` không dọn khi mở file mới | `openBytes` L121–155 | Rò rỉ bộ nhớ khi mở nhiều file |

### 1.4 Bản web
Bản web (`web/index.html`, 639 dòng) dùng pdf.js v4.10.38 + pdf-lib + fontkit qua CDN. **Hiện chỉ có: mở PDF, thêm chữ, tẩy hình chữ nhật, lưu.** **Không có** bút, dạ quang, chèn ảnh, chữ ký, thumbnail. → Đồng bộ toàn bộ là khối lượng lớn; xem mục 6.

---

## 2. Nguyên tắc triển khai

1. Tạo nhánh `feature/fonts-erase-signature`; commit nhỏ theo từng lỗi để dễ revert.
2. **Không phá vỡ dữ liệu cũ**: giữ nguyên type `rect`/`text`/`img`/`ink`; chỉ *thêm* type mới, không refactor thay thế.
3. Mỗi giai đoạn phải kèm test; chạy `npm test`, `npm run test:e2e`, `npm run test:overlay` trước khi sang giai đoạn kế.
4. Mọi tính năng phụ thuộc pdf.js (bám dòng chữ) phải có **fallback im lặng** cho PDF scan (không có lớp chữ).
5. Cập nhật `README.md` + ảnh trong `docs/` khi đổi tính năng/đếm font.

---

## 3. Giai đoạn 0 — Chuẩn bị (bắt buộc làm trước)

- [ ] Tạo nhánh; chạy baseline `npm install` trong `app/` và `app/test/tools/`, ghi lại kết quả `npm test` / `test:e2e` / `test:overlay` hiện tại.
- [ ] Thêm `test/fonts-coverage.mjs`: dùng `fontkit` parse từng file trong `renderer/fonts/`, đối chiếu **134 ký tự tiếng Việt** (ă â đ ê ô ơ ư × 5 dấu thanh, hoa+thường). In bảng `font | có/thiếu | %`. Exit code ≠ 0 nếu thiếu.
- [ ] Chạy test này để **audit 17 font hiện có** → danh sách font "partial" sẽ được gắn nhãn cảnh báo ở UI.
- [ ] Thêm `test/signature.mjs` (khung): dựng stroke trên pad bằng sự kiện tổng hợp → đặt → xuất → kiểm tra bbox.

**Nghiệm thu:** biết chính xác font nào thiếu dấu; có lưới test cho 3 mảng.

---

## 4. Giai đoạn 1 — Sửa lỗi chữ ký (ưu tiên cao, rủi ro thấp)

Làm trước vì sửa được lỗi thật, ít đụng chạm kiến trúc.

| Task | Nội dung | File |
|---|---|---|
| 1.1 | `openSig()` reset `libSel=null`, `sigOut=null`, `sigSrcImg=null`; đồng bộ slider `padW`/màu mực theo `pad` | `app.js` L590–600 |
| 1.2 | Sau khi đặt thành công, xoá `pad.strokes` + `redrawPad()`; thêm tuỳ chọn "Giữ nét sau khi đặt" (mặc định **tắt**) | `useSignature` L704–717 |
| 1.3 | **Redraw pad đầy đủ khi `pointerup`** (`redrawPad()`), khử sai lệch incremental-vs-full; gộp sự kiện coalesced trước khi vẽ | `padC` handler L614–630 |
| 1.4 | **Viết lại `recolor()` theo độ sáng**: có alpha → giữ alpha, đổi RGB; không alpha → `alpha = 1 − chuẩn hoá(luminance)`, RGB = màu chọn (dùng lại pipeline tách nền). Không còn khối đặc với JPG | `recolor` L578–583, `recolorBtn` L573 |
| 1.5 | **Chống trùng thư viện**: băm (hash) nội dung ảnh trước khi lưu; nếu đã có → bỏ qua + toast "Đã có trong thư viện". Thêm đếm số lượng, xoá nhiều, đổi tên | `useSignature` L714, `renderLib` L691–702 |
| 1.6 | Cải thiện tách nền/cắt sát: ngưỡng **Otsu tự động** cho `bgTol`; `alphaMin` crop theo tỉ lệ ảnh (không cố định 40); `padPx` theo tỉ lệ; thêm "làm đậm/mảnh nét"; xem trước trên nền trắng **và** nền carô | `processSigImage` L648–683, `trimCanvas` L635–641 |
| 1.7 | Sửa guard bàn phím: chặn `Ctrl+S` khi modal mở; `Escape` đóng mọi modal và reset trạng thái | `keydown` L839–855 |
| 1.8 | Dọn `imgStore` khi mở file mới; gán lại `srcSeq` | `openBytes` L121–155 |

**Nghiệm thu (`test/signature.mjs` + thủ công):**
- Đặt chữ ký → mở lại hộp thoại: pad trống.
- Đặt cùng một chữ ký 3 lần: thư viện chỉ tăng 1 bản.
- Nhập JPG chữ ký → "Đổi màu nét": nét đổi màu, **không** thành khối đặc (kiểm tra phương sai alpha > 0).
- Chữ ký mảnh: cắt sát không mất nét.

---

## 5. Giai đoạn 2 — Font chữ

### 5.1 Bổ sung font (có kiểm chứng)
- Chọn ~10–12 font mới, **bắt buộc qua `fonts-coverage.mjs`** trước khi nhận. Ưu tiên nhóm:
  - **Viết tay gọn:** Caveat*, Gochi Hand, Coming Soon, Cedarville Cursive
  - **Kiểu chữ ký:** Sacramento, Allura, Italianno, Pinyon Script, Parisienne
  - **Viết nhanh / bác sĩ:** thêm 2–3 font
  - **In / serif (mới):** Lora, Playfair Display, Merriweather
  - **Mono / typewriter (mới):** Courier Prime, Special Elite, JetBrains Mono
  - **Học sinh / giáo dục (mới):** Playpen Sans, Edu QLD Beginner (nếu đủ dấu)
- (*) **Caveat phải kiểm tra kỹ** — nguồn ngoài cho thấy chỉ 34/256 glyph khối Latin Extended Additional.
- Tải `.ttf` (subset `vietnamese`) vào `app/renderer/fonts/`; ghi nguồn + giấy phép OFL vào README.
- Cập nhật `FONTS` (`app.js` L11–29) theo cấu trúc `{key, name, group, file}`.

### 5.2 Nhóm font động
- Thay mảng hardcode `[G_NEAT, G_SIGN, G_DOC]` bằng danh sách nhóm suy ra từ `FONTS`; bỏ hardcode `"17 phông"` → dùng `FONTS.length`.

### 5.3 Nâng cấp UI bộ chọn font
- Ô **tìm kiếm** theo tên/nhóm.
- Ô **chữ xem trước tuỳ chỉnh** (mặc định `SAMPLE`), lưu `localStorage`.
- **Ghim font hay dùng** → hiển thị nhóm "Đã ghim" trên đầu; lưu `localStorage`.
- **Lazy-load preview** bằng `IntersectionObserver` (thay vì tải hết như L90).
- **Nhãn cảnh báo** font thiếu dấu, dựa trên kết quả `fonts-coverage.mjs` (lưu JSON tĩnh `renderer/fonts/coverage.json`).
- Thanh chỉnh cỡ chữ xem trước.

### 5.4 Giảm dung lượng PDF
- Đổi `embedFont(..., { subset:false })` → **`subset:true`**, giữ `features` tắt ligature. **Bọc try/catch, fallback về `subset:false`** cho font lỗi.
- Thêm test so sánh dung lượng PDF trước/sau với cùng nội dung.

### 5.5 Bản web
- Cập nhật `FONTS` trong `web/index.html` (L187–205) với `gf` name mới; thêm nhóm; đồng bộ UI tìm kiếm/ghim.

**Nghiệm thu:** mọi font mới qua coverage test; xuất PDF nhiều font → dung lượng giảm rõ rệt; UI chọn font có tìm kiếm + ghim + cảnh báo thiếu dấu.

---

## 6. Giai đoạn 3 — Tẩy/xoá nâng cao

### 6.1 Kiến trúc: thêm 2 type mới, không refactor `rect`
Thêm object type `brush` và `lasso` (song song `rect`), mỗi type ~6 điểm chạm: `KEYS` (L315), `createObj` (L393), `layout` (L471), `onLayerDown` (L336), `startDrag/startResize` (L521/531), `buildPdf` (L760).
- `brush`: `{ pts:[[x,y]...], width, color }` → hiển thị SVG stroke đặc; xuất: stroke path khi flatten.
- `lasso`: `{ pts:[[x,y]...], color }` → hiển thị SVG polygon; xuất: fill polygon.
- Tách helper dùng chung `paintMasks(ctx, masks, toCanvasPt)` cho cả flatten và preview.

### 6.2 Bám dòng chữ (snap)
- Cache `pg.lines = [{x,y,w,h,text}]` từ `pdfPage.getTextContent()`, dùng `pdfjsLib.Util.transform(pg.vp1.transform, item.transform)` rồi gộp item theo dòng.
- Khi kết thúc kéo rect: **nới/thu rect theo dòng chữ giao nhau** (đỉnh dòng đầu → đáy dòng cuối, +đệm nhỏ). Giữ `Alt` để tắt snap.
- Thêm chế độ **"Chọn dòng để che"**: click gần dòng → tạo rect khớp dòng đó.
- Hiện **guide** làm nổi dòng dưới con trỏ khi đang kéo.
- PDF scan không có text → bỏ qua êm, hiện gợi ý trong UI.

### 6.3 Nền phức tạp
Thêm `fillMode` cho mỗi mask: `'color' | 'gradient' | 'clone'` (mặc định `gradient`).
- `gradient`: lấy màu 4 góc **ngay ngoài** rect, dựng canvas 2×2 rồi scale phóng to có smoothing → nền chuyển sắc mượt, xử lý được scan sáng không đều.
- `clone`: copy dải nền phía trên rect (cùng chiều cao) → hợp với giấy có dòng kẻ/bảng biểu.
- `feather`: làm mờ mép vá để không lộ đường viền.

### 6.4 Chất lượng khi "xoá hẳn"
- `flattenPage(doc, i, masks, opts)` với `opts = { dpi, format:'auto'|'jpeg'|'png', quality }`.
- `auto`: phân tích trang (tỉ lệ pixel gần trắng / phương sai màu) → **PNG lossless cho PDF chữ**, JPEG cho PDF scan/ảnh.
- Thêm chọn DPI (150/200/300/600) + chất lượng JPEG; giữ trần 7000px.
- Ước lượng dung lượng đầu ra và **cảnh báo trước khi lưu** nếu vượt ngưỡng.
- Ghi rõ trong UI: rasterize cả trang là **bắt buộc** để xoá thật lớp chữ (không thể chỉ rasterize vùng che mà vẫn xoá được text).

### 6.5 Hộp thoại Lưu
- Thêm: chọn "Xoá hẳn (rasterize)" / "Chỉ che phủ"; nếu rasterize → format + DPI + chất lượng; hiện **ước lượng dung lượng**.
- Thêm nút **"Xem trước kết quả"** (rasterize thử trang đầu có mask và hiển thị).

### 6.6 Bản web
- Đồng bộ: cọ xoá + lasso, snap dòng chữ (pdf.js có sẵn), `fillMode` gradient/clone, tuỳ chọn chất lượng khi lưu.

**Nghiệm thu:** mở rộng `test/overlay.mjs` với mask brush/lasso/snap; xuất PNG vs JPEG và so dung lượng; kiểm tra PDF xoay 90/180/270 vẫn che đúng vị trí.

---

## 7. Giai đoạn 4 — Đồng bộ web & hoàn thiện

> ⚠️ **Điểm cần quyết định:** bản web hiện **không có** chữ ký/bút/dạ quang/ảnh/thumbnail. Port **toàn bộ** sang web là khối lượng ngang một tính năng lớn. Đề xuất thứ tự: (a) font → (b) tẩy/xoá → (c) *tuỳ chọn* dựng module chữ ký cho web ở giai đoạn riêng.

- [ ] Đồng bộ font + tẩy/xoá sang `web/index.html`.
- [ ] Cập nhật `README.md`: số font, nhóm font, tính năng tẩy/xoá mới, hạn chế mới, giấy phép font mới.
- [ ] Cập nhật ảnh `docs/` (bộ chọn font mới, cọ xoá, snap dòng, hộp thoại lưu mới).
- [ ] Bump `version` trong `app/package.json`; kiểm tra `npm run build` (Windows x64).
- [ ] Chạy full test trên Windows; nếu cần, chạy thêm trên Linux/xvfb.

---

## 8. Rủi ro & giảm thiểu

| Rủi ro | Giảm thiểu |
|---|---|
| `subset:true` gây lỗi nhúng một số font | try/catch + fallback `subset:false` từng font; test xuất PDF nhiều font |
| Font "có tag vietnamese" nhưng thiếu dấu chồng | Bắt buộc qua `fonts-coverage.mjs`; gắn nhãn cảnh báo ở UI |
| Snap dòng chữ hỏng với PDF scan | Fallback im lặng + gợi ý UI |
| PNG 300dpi làm file rất nặng | Ước lượng + cảnh báo trước khi lưu; cho chọn JPEG/DPI |
| Thêm type mới làm hỏng undo/export | Giữ nguyên `rect`; mở rộng `KEYS`; test undo/redo + overlay |
| Lệch toạ độ với trang PDF xoay | Test riêng trang rotate 90/180/270 trước khi merge |
| Port web đội khối lượng lớn | Chia nhỏ theo thứ tự ưu tiên (mục 7), không gộp một lần |

---

## 9. Thứ tự thực hiện đề xuất

1. **Giai đoạn 0** — nhánh, baseline, 2 test khung, audit font.
2. **Giai đoạn 1** — sửa 8 lỗi chữ ký (giá trị cao nhất, rủi ro thấp nhất).
3. **Giai đoạn 2** — font: bổ sung + nhóm + UI + subset.
4. **Giai đoạn 3** — tẩy/xoá: brush/lasso, snap dòng, nền gradient, chất lượng flatten.
5. **Giai đoạn 4** — đồng bộ web, README, ảnh, build.

Sau mỗi giai đoạn: chạy test + demo thủ công để bạn nghiệm thu trước khi sang bước tiếp theo.
