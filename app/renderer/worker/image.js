const MAX_EDGE_FALLBACK = 10000;

window.workerApi.onTask(async task => {
  try {
    const response = await fetch(task.url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Không đọc được ảnh (${response.status}).`);
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    try {
      const maxEdge = Number.isInteger(task.maxEdge) ? task.maxEdge : MAX_EDGE_FALLBACK;
      const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Không tạo được canvas.');
      // Ảnh trong suốt đặt trên nền trắng.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(bitmap, 0, 0, width, height);

      const png = await new Promise((resolve, reject) => {
        canvas.toBlob(
          b => (b ? resolve(b) : reject(new Error('Không tạo được PNG.'))),
          'image/png',
        );
      });
      const bytes = new Uint8Array(await png.arrayBuffer());
      window.workerApi.done(task.id, bytes, width, height);
    } finally {
      try { bitmap.close(); } catch { /* bitmap có thể đã đóng */ }
    }
  } catch (e) {
    window.workerApi.error(task.id, String(e?.message || e));
  }
});

// Chỉ báo sẵn sàng sau khi onTask đã đăng ký xong.
window.workerApi.ready();
