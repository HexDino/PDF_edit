const { spawn, execFileSync } = require('node:child_process');

function runProcess(file, args, { signal, cwd, env, timeoutMs = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd, env, windowsHide: true, shell: false });
    let stdout = '', stderr = '', settled = false, timer;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      fn(value);
    };
    const killTree = () => {
      try {
        if (process.platform === 'win32') {
          execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        } else {
          child.kill('SIGKILL');
        }
      } catch { /* tiến trình có thể đã thoát */ }
    };
    const onAbort = () => {
      killTree();
      finish(reject, Object.assign(new Error('Đã huỷ'), { code: 'CANCELLED' }));
    };

    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', e => finish(reject, e));
    child.on('close', code => {
      if (code === 0) finish(resolve, { stdout, stderr, code });
      else finish(reject, Object.assign(new Error(stderr.trim() || `Lỗi (mã ${code})`), {
        code: 'PROCESS_FAILED', exitCode: code, stderr,
      }));
    });

    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
    }
    if (timeoutMs) {
      timer = setTimeout(() => {
        killTree();
        finish(reject, Object.assign(new Error('Quá thời gian'), { code: 'TIMEOUT' }));
      }, timeoutMs);
    }
  });
}

module.exports = { runProcess };
