const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { ToolError, toPayload } = require('./errors');
const { validateOptions } = require('./schema');
const { runProcess } = require('./util/spawn');

// Thời gian chờ tối đa để tool tự kết thúc sau khi bị huỷ. Quá hạn này job
// vẫn được coi là đã huỷ và nhường slot, kể cả khi tool bỏ qua ctx.signal.
const CANCEL_GRACE_MS = 1000;
const PROGRESS_THROTTLE_MS = 100;
// Thư mục job cũ hơn mốc này được coi là rác của lần chạy trước (crash/thoát
// cưỡng bức). Mốc 1 giờ đủ rộng để không đụng job của instance test/dev đang chạy.
const STALE_JOB_AGE_MS = 60 * 60 * 1000;

class JobRunner {
  constructor({ tools, onEvent, qpdfPath, tempRoot, concurrency = 2, log = () => {}, render = null, image = null, staleJobMaxAgeMs = STALE_JOB_AGE_MS }) {
    this.tools = new Map(tools.map(t => [t.id, t]));
    this.onEvent = onEvent;
    this.qpdfPath = qpdfPath;
    this.render = render;
    this.image = image;
    this.tempRoot = tempRoot || path.join(os.tmpdir(), 'TrinhSuaPDF', 'jobs');
    this.concurrency = concurrency;
    this.log = log;
    this.queue = [];
    this.running = new Map();
    fs.mkdirSync(this.tempRoot, { recursive: true });
    this.#sweepStaleDirs(staleJobMaxAgeMs);
  }

  /** Dọn thư mục job còn sót từ lần chạy trước; lỗi chỉ ghi log. */
  #sweepStaleDirs(maxAgeMs) {
    let entries;
    try {
      entries = fs.readdirSync(this.tempRoot, { withFileTypes: true });
    } catch (e) {
      this.#safeLog(`temp sweep read error: ${e?.message || e}`);
      return;
    }
    const cutoff = Date.now() - maxAgeMs;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(this.tempRoot, entry.name);
      try {
        const stat = fs.statSync(dir);
        if (stat.mtimeMs > cutoff) continue;
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
        this.#safeLog(`temp sweep removed ${entry.name}`);
      } catch (e) {
        this.#safeLog(`temp sweep failed ${entry.name}: ${e?.message || e}`);
      }
    }
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
      terminal: false,
    };
    this.queue.push(job);
    this.#emit(job, { type: 'queued' });
    this.#pump();
    return job.id;
  }

  cancel(id) {
    const running = this.running.get(id);
    if (running) {
      if (running.terminal) return false;
      running.controller.abort();
      return true;
    }
    const queued = this.queue.find(j => j.id === id);
    if (!queued) return false;
    this.queue = this.queue.filter(j => j !== queued);
    this.#finish(queued, 'cancelled');
    return true;
  }

  #pump() {
    while (this.running.size < this.concurrency && this.queue.length) {
      const job = this.queue.shift();
      if (job.controller.signal.aborted || job.terminal) continue;
      job.state = 'running';
      this.running.set(job.id, job);
      // #run không bao giờ reject; catch này chỉ là chốt chặn cuối để một lỗi
      // bất ngờ không tạo unhandled rejection và không làm kẹt slot.
      this.#run(job)
        .catch(e => {
          this.#safeLog(`job ${job.id} runner failure: ${e?.stack || e?.message || e}`);
          this.#finish(job, 'error', { error: toPayload(e) });
        })
        .finally(() => {
          this.running.delete(job.id);
          this.#pump();
        })
        .catch(e => {
          // Chốt chặn cuối: không để chuỗi hoàn tất tạo unhandled rejection.
          this.#safeLog(`job ${job.id} pump failure: ${e?.stack || e?.message || e}`);
        });
    }
  }

  async #run(job) {
    const startedAt = Date.now();
    let tempDir = null;
    try {
      this.#emit(job, { type: 'started' });
      try {
        tempDir = fs.mkdtempSync(path.join(this.tempRoot, `${job.id.slice(0, 8)}-`));
      } catch {
        throw new ToolError('INTERNAL', 'Không tạo được thư mục tạm.');
      }
      const ctx = {
        jobId: job.id,
        files: job.files,
        options: job.options,
        outputDir: job.outputDir,
        tempDir,
        signal: job.controller.signal,
        log: message => this.#safeLog(message),
        progress: (phase, current, total, message) => this.#progress(job, { phase, current, total, message }),
        qpdf: (args, opts = {}) => runProcess(this.qpdfPath, args, { ...opts, signal: job.controller.signal }),
        render: this.render,
        // Ảnh tạm luôn nằm trong thư mục job và luôn dùng signal của job.
        image: this.image ? {
          toPng: filePath => this.image.toPng(filePath, { outDir: tempDir, signal: job.controller.signal }),
        } : null,
      };
      ctx.progress('reading', 0, 1, 'Đang đọc file…');
      const result = await this.#runTool(job, ctx);
      if (job.controller.signal.aborted) throw new ToolError('CANCELLED', 'Đã huỷ');
      const outputs = this.#collectOutputs(result);
      this.#finish(job, 'done', {
        outputs,
        errors: result?.errors || [],
        stats: { ...(result?.stats || {}), ms: Date.now() - startedAt },
      });
    } catch (e) {
      const cancelled = job.controller.signal.aborted || e?.code === 'CANCELLED';
      this.#safeLog(`job ${job.id} ${cancelled ? 'cancelled' : 'error'}: ${e?.stack || e?.message || e}`);
      if (cancelled) this.#finish(job, 'cancelled');
      else this.#finish(job, 'error', { error: toPayload(e) });
    } finally {
      this.#cleanup(job, tempDir);
      this.#safeLog(`job ${job.id} finished in ${Date.now() - startedAt}ms`);
    }
  }

  // Chạy tool nhưng không để nó giữ slot vô hạn: sau khi huỷ, chờ tối đa
  // CANCEL_GRACE_MS rồi bỏ rơi promise của tool (đã gắn catch) để dọn dẹp.
  #runTool(job, ctx) {
    const signal = job.controller.signal;
    const toolPromise = Promise.resolve().then(() => job.tool.run(ctx));

    return new Promise((resolve, reject) => {
      let settled = false;
      let graceTimer = null;

      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(graceTimer);
        signal.removeEventListener('abort', onAbort);
        fn(value);
      };
      const onAbort = () => {
        if (settled || graceTimer) return;
        graceTimer = setTimeout(() => {
          finish(reject, new ToolError('CANCELLED', 'Đã huỷ'));
        }, CANCEL_GRACE_MS);
      };

      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });

      toolPromise
        .then(value => finish(resolve, value), error => finish(reject, error))
        .catch(() => { /* tool bỏ qua signal: kết quả muộn bị bỏ, không unhandled */ });
    });
  }

  #collectOutputs(result) {
    const reported = Array.isArray(result?.outputs) ? result.outputs : [];
    if (!reported.length) throw new ToolError('INTERNAL', 'Không tạo được file kết quả.');
    return reported.map(o => {
      const outputPath = o?.path;
      if (typeof outputPath !== 'string' || !outputPath) {
        throw new ToolError('INTERNAL', 'File kết quả không tồn tại.');
      }
      let stat = null;
      try { stat = fs.statSync(outputPath); } catch { /* báo lỗi bên dưới */ }
      if (!stat?.isFile()) throw new ToolError('INTERNAL', 'File kết quả không tồn tại.');
      return { ...o, bytes: stat.size };
    });
  }

  #finish(job, type, data = {}) {
    if (job.terminal) return false;
    job.terminal = true;
    job.state = type;
    this.#emit(job, { type, ...data });
    return true;
  }

  #progress(job, data) {
    if (job.state !== 'running' || job.terminal) return;
    const now = Date.now();
    const samePhase = job._lastPhase === data.phase;
    if (samePhase && job._lastProgress && now - job._lastProgress < PROGRESS_THROTTLE_MS && data.current !== data.total) return;
    job._lastProgress = now;
    job._lastPhase = data.phase;
    this.#emit(job, { type: 'progress', ...data });
  }

  #cleanup(job, tempDir) {
    if (!tempDir) return;
    try {
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    } catch (e) {
      this.#safeLog(`job ${job.id} cleanup error: ${e?.message || e}`);
    }
  }

  #safeLog(message) {
    try {
      if (typeof this.log === 'function') this.log(message);
    } catch { /* log không được làm hỏng job */ }
  }

  #emit(job, data) {
    try {
      const pending = this.onEvent?.({ jobId: job.id, toolId: job.tool.id, ...data });
      if (pending && typeof pending.then === 'function') {
        pending.catch(e => this.#safeLog(`onEvent error: ${e?.message || e}`));
      }
    } catch (e) {
      this.#safeLog(`onEvent error: ${e?.message || e}`);
    }
  }
}

module.exports = { JobRunner };
