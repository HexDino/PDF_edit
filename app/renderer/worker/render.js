import * as pdfjsLib from '../vendor/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;

window.workerApi.onTask(async task => {
  let doc = null;
  try {
    doc = await pdfjsLib.getDocument({
      url: task.url, isEvalSupported: false,
      cMapUrl: new URL('../vendor/cmaps/', import.meta.url).href, cMapPacked: true,
      standardFontDataUrl: new URL('../vendor/standard_fonts/', import.meta.url).href,
    }).promise;
    for (let i = 0; i < task.pages.length; i++) {
      const n = task.pages[i];
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: task.dpi / 72 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil(vp.width));
      canvas.height = Math.max(1, Math.ceil(vp.height));
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(
          b => (b ? resolve(b) : reject(new Error('Không tạo được ảnh từ trang PDF.'))),
          task.format === 'png' ? 'image/png' : 'image/jpeg',
          task.quality,
        );
      });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      window.workerApi.page(task.id, n, bytes, { width: canvas.width, height: canvas.height });
      window.workerApi.progress(task.id, i + 1, task.pages.length);
      page.cleanup();
    }
    window.workerApi.done(task.id, null);
  } catch (e) {
    window.workerApi.done(task.id, String(e?.message || e));
  } finally {
    try { await doc?.destroy(); } catch { /* tài liệu có thể đã lỗi */ }
  }
});

// Chỉ báo sẵn sàng sau khi onTask đã đăng ký xong.
window.workerApi.ready();
