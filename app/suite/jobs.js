const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { ToolError, toPayload } = require('./errors');
const { validateOptions } = require('./schema');
const { runProcess } = require('./util/spawn');

class JobRunner {
  constructor({ tools, onEvent, qpdfPath, tempRoot, concurrency = 2, log = () => {} }) {
    this.tools = new Map(tools.map(t => [t.id, t]));
    this.onEvent = onEvent;
    this.qpdfPath = qpdfPath;
    this.tempRoot = tempRoot || path.join(os.tmpdir(), 'TrinhSuaPDF', 'jobs');
    this.concurrency = concurrency;
    this.log = log;
    this.queue = [];
    this.running = new Map();
    fs.mkdirSync(this.tempRoot, { recursive: true });
  }

  start({ toolId, files, options, outputDir }) {
    const tool = this.tools.get(toolId);
    if (!tool || tool.status !== 'available' || typeof tool.run !== 'function') {
      throw new ToolError('UNSUPPORTED', 'Công cụ này chưa sẵn sàng.');
    }
    if (!Array.isArray(files) || !files.length) throw new ToolError('INVALID_FILE', 'Chưa chọn file.');
    if (tool.multiple === false && files.length !== 1) throw new ToolError('INVALID_FILE', 'Công cụ này chỉ nhận một file.');
    if (tool.minFiles && files.length < tool.minFiles) throw new ToolError('INVALID_FILE', `Cần ít nhất ${tool.minFiles} file.`);
    for (const f of files) {
      if (typeof f !== 'string' || !fs.existsSync(f) || !fs.statSync(f).isFile()) {
        throw new ToolError('INVALID_FILE', 'File không tồn tại.');
      }
      if (Array.isArray(tool.accept)) {
        const ext = path.extname(f).toLowerCase();
        if (!tool.accept.includes(ext)) {
          throw new ToolError('INVALID_FILE', `Định dạng không hỗ trợ: ${path.basename(f)}.`);
        }
      }
    }
    const job = {
      id: randomUUID(), tool, files, options: validateOptions(tool, options),
      outputDir: outputDir || null, controller: new AbortController(), state: 'queued',
    };
    this.queue.push(job);
    this.#emit(job, { type: 'queued' });
    this.#pump();
    return job.id;
  }

  cancel(id) {
    const running = this.running.get(id);
    if (running) { running.controller.abort(); return true; }
    const queued = this.queue.find(j => j.id === id);
    if (!queued) return false;
    this.queue = this.queue.filter(j => j !== queued);
    queued.state = 'cancelled';
    this.#emit(queued, { type: 'cancelled' });
    return true;
  }

  #pump() {
    while (this.running.size < this.concurrency && this.queue.length) {
      const job = this.queue.shift();
      if (job.controller.signal.aborted) continue;
      job.state = 'running';
      this.running.set(job.id, job);
      this.#run(job).finally(() => {
        this.running.delete(job.id);
        this.#pump();
      });
    }
  }

  async #run(job) {
    const tempDir = fs.mkdtempSync(path.join(this.tempRoot, `${job.id.slice(0, 8)}-`));
    const ctx = {
      jobId: job.id,
      files: job.files,
      options: job.options,
      outputDir: job.outputDir,
      tempDir,
      signal: job.controller.signal,
      log: this.log,
      progress: (phase, current, total, message) => this.#progress(job, { phase, current, total, message }),
      qpdf: (args, opts = {}) => runProcess(this.qpdfPath, args, { ...opts, signal: job.controller.signal }),
    };
    const started = Date.now();
    try {
      this.#emit(job, { type: 'started' });
      ctx.progress('reading', 0, 1, 'Đang đọc file…');
      const result = await job.tool.run(ctx);
      if (job.controller.signal.aborted) throw new ToolError('CANCELLED', 'Đã huỷ');
      const outputs = (result?.outputs || []).map(o => ({
        ...o,
        bytes: fs.existsSync(o.path) ? fs.statSync(o.path).size : 0,
      }));
      if (!outputs.length) throw new ToolError('INTERNAL', 'Không tạo được file kết quả.');
      job.state = 'done';
      this.#emit(job, {
        type: 'done', outputs, errors: result?.errors || [],
        stats: { ...(result?.stats || {}), ms: Date.now() - started },
      });
    } catch (e) {
      const cancelled = job.controller.signal.aborted || e.code === 'CANCELLED';
      this.log(`job ${job.id} ${cancelled ? 'cancelled' : 'error'}: ${e.stack || e.message}`);
      job.state = cancelled ? 'cancelled' : 'error';
      if (cancelled) this.#emit(job, { type: 'cancelled' });
      else this.#emit(job, { type: 'error', error: toPayload(e) });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
      this.log(`job ${job.id} finished in ${Date.now() - started}ms`);
    }
  }

  #progress(job, data) {
    const now = Date.now();
    if (job._lastProgress && now - job._lastProgress < 100 && data.current !== data.total) return;
    job._lastProgress = now;
    this.#emit(job, { type: 'progress', ...data });
  }

  #emit(job, data) {
    try { this.onEvent?.({ jobId: job.id, toolId: job.tool.id, ...data }); }
    catch (e) { this.log(`onEvent error: ${e.message}`); }
  }
}

module.exports = { JobRunner };
