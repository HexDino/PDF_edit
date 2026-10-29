const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('workerApi', {
  // Bắt tay sẵn sàng: render.js chỉ gọi sau khi đã đăng ký onTask, nên main
  // không bao giờ gửi task trước khi worker có thể nhận.
  ready: () => ipcRenderer.send('render:ready'),
  onTask: cb => ipcRenderer.on('render:task', (_e, task) => cb(task)),
  page: (taskId, page, bytes, meta) => ipcRenderer.send('render:page', { taskId, page, bytes, meta }),
  progress: (taskId, current, total) => ipcRenderer.send('render:progress', { taskId, current, total }),
  done: (taskId, error) => ipcRenderer.send('render:done', { taskId, error }),
});
