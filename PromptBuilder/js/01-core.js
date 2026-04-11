'use strict';

/* =====================================================================
   1. CONSTANTS
   ===================================================================== */
const DB_NAME    = 'prompt-builder-v2';
const DB_VERSION = 1;
const STORE_C    = 'canvases';
const STORE_B    = 'blocks';

const BLOCK_COLOR_OPTIONS = [
  { id: 'blue',   label: '蓝色', value: '#228be6' },
  { id: 'green',  label: '绿色', value: '#2f9e44' },
  { id: 'orange', label: '橙色', value: '#e67700' },
  { id: 'pink',   label: '粉色', value: '#d6336c' },
  { id: 'violet', label: '紫色', value: '#7048e8' },
];
const DEFAULT_BLOCK_COLOR = BLOCK_COLOR_OPTIONS[0].id;
const BLOCK_COLOR_MAP = Object.fromEntries(BLOCK_COLOR_OPTIONS.map(opt => [opt.id, opt.value]));

/* =====================================================================
   2. DATABASE
   ===================================================================== */
const DB = {
  _db: null,

  isReady() {
    return !!DB._db;
  },

  open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_C)) {
          db.createObjectStore(STORE_C, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_B)) {
          const bs = db.createObjectStore(STORE_B, { keyPath: 'id' });
          bs.createIndex('canvasId', 'canvasId');
        }
      };
      req.onsuccess = (e) => { DB._db = e.target.result; resolve(); };
      req.onerror   = (e) => reject(e.target.error);
    });
  },

  _p(req) {
    return new Promise((res, rej) => {
      req.onsuccess = e => res(e.target.result);
      req.onerror   = e => rej(e.target.error);
    });
  },

  getAllCanvases() {
    const s = DB._db.transaction(STORE_C, 'readonly').objectStore(STORE_C);
    return DB._p(s.getAll()).then(list => list.sort((a, b) => b.createdAt - a.createdAt));
  },

  saveCanvas(c) {
    const s = DB._db.transaction(STORE_C, 'readwrite').objectStore(STORE_C);
    return DB._p(s.put(c));
  },

  deleteCanvas(id) {
    const s = DB._db.transaction(STORE_C, 'readwrite').objectStore(STORE_C);
    return DB._p(s.delete(id));
  },

  getBlocksByCanvas(canvasId) {
    return new Promise((res, rej) => {
      const s   = DB._db.transaction(STORE_B, 'readonly').objectStore(STORE_B);
      const idx = s.index('canvasId');
      const req = idx.getAll(IDBKeyRange.only(canvasId));
      req.onsuccess = e => res(e.target.result);
      req.onerror   = e => rej(e.target.error);
    });
  },

  getAllBlocks() {
    const s = DB._db.transaction(STORE_B, 'readonly').objectStore(STORE_B);
    return DB._p(s.getAll());
  },

  saveBlock(b) {
    const s = DB._db.transaction(STORE_B, 'readwrite').objectStore(STORE_B);
    return DB._p(s.put(b));
  },

  deleteBlock(id) {
    const s = DB._db.transaction(STORE_B, 'readwrite').objectStore(STORE_B);
    return DB._p(s.delete(id));
  },

  deleteBlocksByCanvas(canvasId) {
    return new Promise((res, rej) => {
      const tx  = DB._db.transaction(STORE_B, 'readwrite');
      const s   = tx.objectStore(STORE_B);
      const idx = s.index('canvasId');
      const req = idx.getAllKeys(IDBKeyRange.only(canvasId));
      req.onsuccess = e => { e.target.result.forEach(k => s.delete(k)); };
      tx.oncomplete = () => res();
      tx.onerror    = e => rej(e.target.error);
    });
  },

  replaceAll(canvases, blocks) {
    return new Promise((res, rej) => {
      if (!DB._db) {
        rej(new Error('IndexedDB unavailable'));
        return;
      }

      const tx = DB._db.transaction([STORE_C, STORE_B], 'readwrite');
      const cs = tx.objectStore(STORE_C);
      const bs = tx.objectStore(STORE_B);

      cs.clear();
      bs.clear();

      (canvases || []).forEach(c => cs.put(c));
      (blocks || []).forEach(b => bs.put(b));

      tx.oncomplete = () => res();
      tx.onerror = e => rej(e.target.error);
      tx.onabort = e => rej(e.target.error || new Error('replaceAll aborted'));
    });
  },
};

/* =====================================================================
   3. STATE
   ===================================================================== */
const S = {
  canvases:       [],    // Canvas[]
  activeCanvasId: null,
  blocks:         [],    // Block[] for active canvas

  get canvas() { return S.canvases.find(c => c.id === S.activeCanvasId) || null; },
};

/* =====================================================================
   4. UTILS
   ===================================================================== */
function uid() {
  return (crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function plainText(html) {
  const d = document.createElement('div');
  d.innerHTML = html;
  return d.innerText || d.textContent || '';
}

function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

function normalizeBlockName(name, fallback = '未命名块') {
  const normalized = (name || '').trim();
  return normalized || fallback;
}

function blockColorValue(colorId) {
  return BLOCK_COLOR_MAP[colorId] || BLOCK_COLOR_MAP[DEFAULT_BLOCK_COLOR];
}

function applyBlockColor(el, colorId) {
  el.style.setProperty('--pipe-color', blockColorValue(colorId));
  el.querySelectorAll('.cb-color-dot').forEach(dot => {
    dot.classList.toggle('active', dot.dataset.color === colorId);
  });
}

function setBlockNameUI(el, name) {
  const normalized = normalizeBlockName(name);
  const label = el.querySelector('.cb-name');
  if (label) {
    label.textContent = normalized;
    label.title = normalized;
  }
}

let _zTop = 10;
function bringToFront(el) { el.style.zIndex = ++_zTop; }

/* =====================================================================
   5. THEME
   ===================================================================== */
const Theme = {
  init() {
    Theme.apply(localStorage.getItem('pb-theme') || 'light');
  },
  toggle() {
    Theme.apply(document.body.classList.contains('dark') ? 'light' : 'dark');
  },
  apply(mode) {
    const btn = document.getElementById('theme-toggle');
    if (mode === 'dark') {
      document.body.classList.add('dark');
      if (btn) btn.textContent = '☀';
    } else {
      document.body.classList.remove('dark');
      if (btn) btn.textContent = '🌙';
    }
    localStorage.setItem('pb-theme', mode);
  },
};

/* =====================================================================
   6. TOAST
   ===================================================================== */
const Toast = {
  _t: null,
  show(msg, ms = 2200) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(Toast._t);
    Toast._t = setTimeout(() => el.classList.remove('show'), ms);
  },
};

const ResultFont = {
  key: 'pb-result-font-scale',
  min: 30,
  max: 150,

  init() {
    const slider = document.getElementById('result-font-slider');
    if (!slider) return;

    const saved = Number(localStorage.getItem(ResultFont.key));
    const initial = Number.isFinite(saved) ? Math.round(saved) : 100;
    ResultFont.apply(initial, false);

    slider.addEventListener('input', (e) => {
      ResultFont.apply(Number(e.target.value), true);
    });
  },

  apply(percent, persist = true) {
    const safe = clamp(Number(percent) || 100, ResultFont.min, ResultFont.max);
    const ratio = safe / 100;
    const px = Math.round(13 * ratio * 10) / 10;

    document.documentElement.style.setProperty('--result-font-scale', String(ratio));
    document.documentElement.style.setProperty('--result-font-size', `${px}px`);

    const content = document.getElementById('result-content');
    if (content) content.style.fontSize = `${px}px`;

    const slider = document.getElementById('result-font-slider');
    if (slider && Number(slider.value) !== safe) slider.value = String(safe);

    const value = document.getElementById('result-font-value');
    if (value) value.textContent = `${safe}%`;

    if (persist) localStorage.setItem(ResultFont.key, String(safe));
  },
};

const EditorSizePref = {
  key: 'pb-editor-rect-percent',
  legacyKey: 'pb-editor-size-percent',
  defaultW: 85,
  defaultH: 85,
  minW: 40,
  maxW: 95,
  minH: 40,
  maxH: 95,

  _round(v) {
    return Math.round(v * 10) / 10;
  },

  _defaultRect() {
    const l = (100 - EditorSizePref.defaultW) / 2;
    const t = (100 - EditorSizePref.defaultH) / 2;
    return {
      l,
      t,
      r: l + EditorSizePref.defaultW,
      b: t + EditorSizePref.defaultH,
    };
  },

  _hasRect(raw) {
    if (!raw || typeof raw !== 'object') return false;
    return ['l', 't', 'r', 'b'].every(k => Number.isFinite(Number(raw[k])));
  },

  _normalizeRect(rect) {
    const fallback = EditorSizePref._defaultRect();
    if (!EditorSizePref._hasRect(rect)) return fallback;

    let l = clamp(Number(rect.l), 0, 100);
    let t = clamp(Number(rect.t), 0, 100);
    let r = clamp(Number(rect.r), 0, 100);
    let b = clamp(Number(rect.b), 0, 100);

    if (r < l) [l, r] = [r, l];
    if (b < t) [t, b] = [b, t];

    let w = clamp(r - l, EditorSizePref.minW, EditorSizePref.maxW);
    let h = clamp(b - t, EditorSizePref.minH, EditorSizePref.maxH);

    const cx = (l + r) / 2;
    const cy = (t + b) / 2;

    l = cx - (w / 2);
    r = cx + (w / 2);
    if (l < 0) {
      r -= l;
      l = 0;
    }
    if (r > 100) {
      l -= (r - 100);
      r = 100;
    }
    l = clamp(l, 0, 100 - w);
    r = l + w;

    t = cy - (h / 2);
    b = cy + (h / 2);
    if (t < 0) {
      b -= t;
      t = 0;
    }
    if (b > 100) {
      t -= (b - 100);
      b = 100;
    }
    t = clamp(t, 0, 100 - h);
    b = t + h;

    return {
      l: EditorSizePref._round(l),
      t: EditorSizePref._round(t),
      r: EditorSizePref._round(r),
      b: EditorSizePref._round(b),
    };
  },

  _rectFromSize(w, h) {
    const safeW = clamp(Number(w) || EditorSizePref.defaultW, EditorSizePref.minW, EditorSizePref.maxW);
    const safeH = clamp(Number(h) || EditorSizePref.defaultH, EditorSizePref.minH, EditorSizePref.maxH);
    const l = (100 - safeW) / 2;
    const t = (100 - safeH) / 2;
    return {
      l,
      t,
      r: l + safeW,
      b: t + safeH,
    };
  },

  _withSize(rect) {
    return {
      l: rect.l,
      t: rect.t,
      r: rect.r,
      b: rect.b,
      w: EditorSizePref._round(rect.r - rect.l),
      h: EditorSizePref._round(rect.b - rect.t),
    };
  },

  readRect() {
    try {
      const raw = JSON.parse(localStorage.getItem(EditorSizePref.key) || '{}');
      if (EditorSizePref._hasRect(raw)) {
        return EditorSizePref._withSize(EditorSizePref._normalizeRect(raw));
      }
    } catch {
      // Ignore malformed data and fallback to legacy/default.
    }

    try {
      const rawLegacy = JSON.parse(localStorage.getItem(EditorSizePref.legacyKey) || '{}');
      const legacyW = Number(rawLegacy.w);
      const legacyH = Number(rawLegacy.h);
      if (Number.isFinite(legacyW) && Number.isFinite(legacyH)) {
        const rect = EditorSizePref._normalizeRect(EditorSizePref._rectFromSize(legacyW, legacyH));
        EditorSizePref.writeRect(rect);
        return EditorSizePref._withSize(rect);
      }
    } catch {
      // Ignore malformed data and fallback to default.
    }

    return EditorSizePref._withSize(EditorSizePref._defaultRect());
  },

  writeRect(lOrRect, t, r, b) {
    const raw = (typeof lOrRect === 'object' && lOrRect !== null)
      ? { l: lOrRect.l, t: lOrRect.t, r: lOrRect.r, b: lOrRect.b }
      : { l: lOrRect, t, r, b };
    const safeRect = EditorSizePref._normalizeRect(raw);
    localStorage.setItem(EditorSizePref.key, JSON.stringify(safeRect));
    localStorage.setItem(EditorSizePref.legacyKey, JSON.stringify({
      w: EditorSizePref._round(safeRect.r - safeRect.l),
      h: EditorSizePref._round(safeRect.b - safeRect.t),
    }));
  },

  read() {
    const rect = EditorSizePref.readRect();
    return { w: rect.w, h: rect.h };
  },

  write(w, h) {
    EditorSizePref.writeRect(EditorSizePref._rectFromSize(w, h));
  },
};

/* =====================================================================
   7. FORMAT TOOLBAR BUILDER (shared by all inline editors)
   ===================================================================== */
function buildFormatToolbar(container, editorEl) {
  const HL = [
    { c: '#ffd43b', l: '黄色' }, { c: '#69db7c', l: '绿色' },
    { c: '#74c0fc', l: '蓝色' }, { c: '#f783ac', l: '粉色' },
    { c: '#ff8787', l: '红色' }, { c: 'CLEAR',   l: '清除' },
  ];
  const TC = [
    { c: '#e03131', l: '红'  }, { c: '#e67700', l: '橙'  },
    { c: '#2f9e44', l: '绿'  }, { c: '#1971c2', l: '蓝'  },
    { c: '#7048e8', l: '紫'  },
  ];

  function mdn(fn) {
    return (e) => { e.preventDefault(); editorEl.focus(); fn(); };
  }

  // Format buttons
  [
    { cmd: 'bold',          html: '<b>B</b>'  },
    { cmd: 'underline',     html: '<u>U</u>'  },
    { cmd: 'italic',        html: '<i>I</i>'  },
    { cmd: 'strikeThrough', html: '<s>S</s>'  },
  ].forEach(({ cmd, html }) => {
    const b = document.createElement('button');
    b.className = 'toolbar-btn'; b.innerHTML = html;
    b.addEventListener('mousedown', mdn(() => document.execCommand(cmd)));
    container.appendChild(b);
  });

  const sep = () => { const d = document.createElement('div'); d.className = 'toolbar-sep'; container.appendChild(d); };
  sep();

  // Highlight swatches
  HL.forEach(({ c, l }) => {
    const sw = document.createElement('div');
    sw.className = c === 'CLEAR' ? 'swatch swatch-clear' : 'swatch';
    sw.title = l;
    if (c !== 'CLEAR') sw.style.background = c; else sw.textContent = '✕';
    sw.addEventListener('mousedown', mdn(() => {
      if (c === 'CLEAR') { document.execCommand('hiliteColor', false, 'transparent'); }
      else if (!document.execCommand('hiliteColor', false, c)) { document.execCommand('backColor', false, c); }
    }));
    container.appendChild(sw);
  });

  sep();

  // Text color swatches
  TC.forEach(({ c, l }) => {
    const sw = document.createElement('div');
    sw.className = 'swatch'; sw.title = l; sw.style.background = c;
    sw.addEventListener('mousedown', mdn(() => document.execCommand('foreColor', false, c)));
    container.appendChild(sw);
  });

  sep();

  // Clear all format
  const cb = document.createElement('button');
  cb.className = 'toolbar-btn'; cb.title = '清除所有格式';
  cb.style.cssText = 'font-size:10px;width:auto;padding:0 4px;';
  cb.textContent = 'Aa✕';
  cb.addEventListener('mousedown', mdn(() => document.execCommand('removeFormat')));
  container.appendChild(cb);
}

