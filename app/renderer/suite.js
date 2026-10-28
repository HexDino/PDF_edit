const API = window.api;
const S = API?.suite;
const $ = id => document.getElementById(id);
const GROUPS = [
  ['organize', 'Tổ chức'], ['stamp', 'Đánh dấu'], ['convert', 'Chuyển đổi'],
  ['optimize', 'Tối ưu'], ['security', 'Bảo mật'],
];
const state = {
  tools: [], tool: null, files: [], options: {}, outputDir: null,
  jobId: null, running: false, lastResult: null, lastError: null,
  search: '', group: null,
};
const pendingJobEvents = [];

const baseName = p => String(p).split(/[\\/]/).pop();
const toast = (msg, ms = 3000) => {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms);
};

function renderNav() {
  const nav = $('nav');
  nav.innerHTML = '';
  const all = document.createElement('button');
  all.className = 'navItem' + (state.group ? '' : ' on');
  all.textContent = 'Trang chủ';
  all.onclick = () => { state.group = null; renderNav(); renderGrid(); };
  nav.appendChild(all);
  for (const [key, label] of GROUPS) {
    const b = document.createElement('button');
    b.className = 'navItem' + (state.group === key ? ' on' : '');
    b.textContent = label;
    b.onclick = () => { state.group = key; renderNav(); renderGrid(); };
    nav.appendChild(b);
  }
}

function renderGrid() {
  const grid = $('toolGrid');
  grid.innerHTML = '';
  const q = state.search.trim().toLowerCase();
  const visible = state.tools.filter(t =>
    (!state.group || t.group === state.group) &&
    (!q || (t.title + ' ' + t.description).toLowerCase().includes(q)));
  for (const [key, label] of GROUPS) {
    if (state.group && state.group !== key) continue;
    const items = visible.filter(t => t.group === key);
    if (!items.length) continue;
    const h = document.createElement('div'); h.className = 'groupTitle'; h.textContent = label;
    grid.appendChild(h);
    for (const t of items) {
      const b = document.createElement('button');
      b.className = 'card'; b.disabled = t.status !== 'available';
      b.innerHTML = `<span class="ic"></span><span><b></b><span></span></span>${t.status !== 'available' ? '<span class="st">Sắp có</span>' : ''}`;
      b.querySelector('.ic').textContent = t.icon || '▧';
      b.querySelector('b').textContent = t.title;
      b.querySelector('span span').textContent = t.description;
      b.onclick = () => { location.hash = '#/tool/' + t.id; };
      grid.appendChild(b);
    }
  }
  $('noResults').hidden = visible.length > 0;
}

function route() {
  const m = /^#\/tool\/([\w-]+)$/.exec(location.hash);
  if (m) openTool(m[1]); else showHome();
}
function showHome() {
  state.tool = null;
  $('toolView').hidden = true; $('homeView').hidden = false;
}
async function openTool(id) {
  const tool = state.tools.find(t => t.id === id);
  if (!tool) return showHome();
  if (tool.status !== 'available') { toast('Công cụ này sẽ có ở đợt sau.'); location.hash = ''; return; }
  state.tool = tool; state.files = []; state.outputDir = null;
  state.lastResult = null; state.lastError = null; state.running = false;
  state.options = defaults(tool);
  $('homeView').hidden = true; $('toolView').hidden = false;
  $('toolTitle').textContent = tool.title;
  $('toolBadge').hidden = true;
  renderFiles(); renderOptions(); renderResult(); updateRun();
}
function defaults(tool) {
  const out = {};
  for (const o of tool.options || []) {
    out[o.key] = o.default !== undefined ? o.default
      : o.type === 'bool' ? false
        : o.type === 'int' ? (o.min ?? 0)
          : o.type === 'enum' ? o.values[0]
            : '';
  }
  return out;
}
function renderOptions() {
  const box = $('options'); box.innerHTML = '';
  for (const o of state.tool.options || []) {
    const f = document.createElement('div'); f.className = 'field';
    const label = document.createElement('label'); label.textContent = o.label || o.key;
    f.appendChild(label);
    if (o.type === 'bool') {
      const row = document.createElement('label'); row.className = 'row';
      const cb = document.createElement('input'); cb.type = 'checkbox';
      cb.checked = !!state.options[o.key];
      cb.onchange = () => { state.options[o.key] = cb.checked; };
      row.appendChild(cb); row.appendChild(document.createTextNode(o.hint || 'Bật'));
      f.appendChild(row);
    } else if (o.type === 'enum') {
      const sel = document.createElement('select');
      for (const v of o.values) {
        const op = document.createElement('option'); op.value = v; op.textContent = o.labels?.[v] || v;
        sel.appendChild(op);
      }
      sel.value = state.options[o.key];
      sel.onchange = () => { state.options[o.key] = sel.value; };
      f.appendChild(sel);
    } else {
      const inp = document.createElement('input');
      inp.type = o.type === 'int' ? 'number' : o.type === 'password' ? 'password' : 'text';
      if (o.type === 'int') { inp.min = o.min; inp.max = o.max; }
      inp.value = state.options[o.key] ?? '';
      inp.placeholder = o.placeholder || '';
      inp.oninput = () => { state.options[o.key] = o.type === 'int' ? Number(inp.value) : inp.value; };
      f.appendChild(inp);
    }
    box.appendChild(f);
  }
}
function renderFiles() {
  const list = $('fileList'); list.innerHTML = '';
  for (const [i, f] of state.files.entries()) {
    const li = document.createElement('li'); li.className = 'fileItem';
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = baseName(f); nm.title = f;
    li.appendChild(nm);
    if (state.tool.multiple) {
      const up = document.createElement('button'); up.textContent = '↑'; up.title = 'Lên';
      up.onclick = () => { if (i > 0) { [state.files[i - 1], state.files[i]] = [state.files[i], state.files[i - 1]]; renderFiles(); } };
      const dn = document.createElement('button'); dn.textContent = '↓'; dn.title = 'Xuống';
      dn.onclick = () => { if (i < state.files.length - 1) { [state.files[i + 1], state.files[i]] = [state.files[i], state.files[i + 1]]; renderFiles(); } };
      li.append(up, dn);
    }
    const rm = document.createElement('button'); rm.textContent = '✕'; rm.title = 'Bỏ file';
    rm.onclick = () => { state.files.splice(i, 1); renderFiles(); updateRun(); };
    li.appendChild(rm);
    list.appendChild(li);
  }
  updateRun();
}
function addFiles(paths) {
  if (!state.tool) return;
  const ext = p => String(p).toLowerCase().match(/\.[^.\\/]+$/)?.[0] || '';
  for (const p of paths) {
    if (!state.tool.accept.includes(ext(p))) { toast('File không đúng định dạng: ' + baseName(p)); continue; }
    if (!state.tool.multiple && state.files.length >= 1) state.files = [];
    state.files.push(p);
  }
  renderFiles();
}
async function pickFiles() {
  if (!S || !state.tool) return;
  const paths = await S.pickFiles({ accept: state.tool.accept, multiple: !!state.tool.multiple });
  addFiles(paths);
}
async function pickOutput() {
  if (!S) return;
  const dir = await S.pickOutput();
  if (dir) { state.outputDir = dir; $('outLabel').textContent = dir; }
}
function updateRun() {
  const min = state.tool?.minFiles || 1;
  $('runBtn').disabled = !state.tool || state.running || state.files.length < min || !S?.jobStart;
}
function renderResult() {
  const box = $('result');
  if (!state.lastResult && !state.lastError) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  if (state.lastError) {
    box.innerHTML = `<div class="err"></div>`;
    box.querySelector('.err').textContent = state.lastError.message || 'Không xử lý được. Thử lại.';
    return;
  }
  const r = state.lastResult;
  box.innerHTML = '<div class="ok"></div><ul></ul><div class="row"></div>';
  box.querySelector('.ok').textContent = `Xong · ${r.outputs.length} file`;
  for (const o of r.outputs) {
    const li = document.createElement('li');
    li.textContent = `${baseName(o.path)} · ${Math.max(1, Math.round((o.bytes || 0) / 1024))} KB`;
    box.querySelector('ul').appendChild(li);
  }
  const open = document.createElement('button'); open.className = 'btn'; open.textContent = 'Mở thư mục';
  open.onclick = () => S?.reveal(r.outputs[0]?.path);
  const again = document.createElement('button'); again.className = 'btn ghost'; again.textContent = 'Chạy lại';
  again.onclick = () => run();
  box.querySelector('.row').append(open, again);
}
async function run() {
  if (!S?.jobStart || !state.tool || state.running) return;
  state.running = true; state.lastResult = null; state.lastError = null;
  state.jobId = null; pendingJobEvents.length = 0;
  renderResult(); updateRun();
  $('progress').hidden = false; $('cancelBtn').hidden = false;
  $('progressBar').max = 1; $('progressBar').value = 0; $('progressText').textContent = 'Đang chuẩn bị…';
  try {
    const res = await S.jobStart({
      toolId: state.tool.id, files: state.files.slice(),
      options: state.options, outputDir: state.outputDir,
    });
    if (!res?.ok) {
      throw Object.assign(new Error(res?.error?.message || 'Không chạy được công cụ.'), { code: res?.error?.code });
    }
    state.jobId = res.jobId;
    // Event có thể về trước khi IPC trả jobId — phát lại sau khi biết id.
    const mine = pendingJobEvents.filter(e => e.jobId === state.jobId);
    pendingJobEvents.length = 0;
    for (const e of mine) onJob(e);
  } catch (e) {
    state.running = false; state.lastError = { message: e.message || 'Không chạy được công cụ.' };
    $('progress').hidden = true; $('cancelBtn').hidden = true;
    renderResult(); updateRun();
  }
}
async function cancel() {
  if (state.jobId) await S?.jobCancel?.(state.jobId);
}
function onJob(ev) {
  if (!state.jobId) { pendingJobEvents.push(ev); return; }
  if (ev.jobId !== state.jobId) return;
  if (ev.type === 'progress') {
    $('progressBar').max = ev.total || 1;
    $('progressBar').value = ev.current || 0;
    $('progressText').textContent = ev.message || '';
    return;
  }
  state.running = false;
  $('progress').hidden = true; $('cancelBtn').hidden = true; updateRun();
  if (ev.type === 'done') { state.lastResult = ev; renderResult(); }
  else if (ev.type === 'error') { state.lastError = ev.error; renderResult(); }
  else if (ev.type === 'cancelled') { toast('Đã huỷ job.'); }
  renderResult();
}
function bind() {
  $('editBtn').onclick = () => S?.openEditor();
  $('backBtn').onclick = () => { location.hash = ''; };
  $('toolSearch').oninput = () => { state.search = $('toolSearch').value; renderGrid(); };
  $('addFilesBtn').onclick = pickFiles;
  $('outBtn').onclick = pickOutput;
  $('runBtn').onclick = run;
  $('cancelBtn').onclick = cancel;
  window.addEventListener('hashchange', route);
  for (const id of ['dropZone', 'toolDrop']) {
    const dz = $(id);
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('over'));
    dz.addEventListener('drop', e => {
      e.preventDefault(); dz.classList.remove('over');
      const paths = [...(e.dataTransfer?.files || [])].map(f => API?.pathForFile?.(f)).filter(Boolean);
      if (state.tool) addFiles(paths);
      else toast(paths.length ? 'Chọn công cụ trước, rồi thêm file.' : 'Không đọc được file.');
    });
  }
  S?.onJobEvent?.(onJob);
}

(async function init() {
  bind();
  if (!S) { $('toolGrid').textContent = 'Chỉ chạy trong ứng dụng desktop.'; return; }
  state.tools = await S.tools();
  renderNav(); renderGrid(); route();
  const health = await S.health();
  if (!health.qpdf?.ok) toast('Thiếu qpdf nên công cụ ghép/khoá sẽ không chạy.', 6000);
})();

window.__suite = {
  state,
  tools: () => state.tools,
  openTool: async id => { location.hash = '#/tool/' + id; await new Promise(r => setTimeout(r, 60)); return state.tool?.id; },
  addFiles,
  setOutputDir: p => { state.outputDir = p; $('outLabel').textContent = p; },
  run,
  waitJob: (ms = 30000) => new Promise((resolve, reject) => {
    const t0 = Date.now();
    const t = setInterval(() => {
      if (!state.running) { clearInterval(t); resolve(state.lastResult || state.lastError); }
      else if (Date.now() - t0 > ms) { clearInterval(t); reject(new Error('timeout')); }
    }, 50);
  }),
};
