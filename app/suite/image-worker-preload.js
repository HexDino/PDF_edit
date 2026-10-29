const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('workerApi', {
  // Bắt tay sẵn sàng: image.js chỉ gọi sau khi đã đăng ký onTask, nên main
  // không bao giờ gửi task trước khi worker có thể nhận.
  ready: () => ipcRenderer.send('image:ready'),
  onTask: cb => ipcRenderer.on('image:task', (_e, task) => cb(task)),
  done: (taskId, bytes, width, height) => ipcRenderer.send('image:done', { taskId, bytes, width, height }),
  error: (taskId, error) => ipcRenderer.send('image:error', { taskId, error }),
});
