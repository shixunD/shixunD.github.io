'use strict';

/* =====================================================================
   8. CANVAS BLOCK RENDERING & MANAGEMENT
   ===================================================================== */
let _rightClickPos = { x: 40, y: 40 }; // position for context-menu new block
let _expandedId    = null;              // currently expanded block id

// Auto-position for new blocks (4-column grid)
function autoPos(idx) {
  const cols = 4, bw = 230, bh = 150, px = 40, py = 40;
  return { x: px + (idx % cols) * bw, y: py + Math.floor(idx / cols) * bh };
}

function blockInPipeline(blockId) {
  const c = S.canvas;
  return c && (c.pipeline || []).some(item => item.blockId === blockId);
}

function makeBlockEl(block) {
  const el = document.createElement('div');
  el.className = 'canvas-block';
  el.dataset.blockId = block.id;
  el.style.left = (block.x || 0) + 'px';
  el.style.top  = (block.y || 0) + 'px';
  el.style.zIndex = 1;
  if (blockInPipeline(block.id)) el.classList.add('in-pipeline');

  const blockName = normalizeBlockName(block.name);
  const colorId = BLOCK_COLOR_MAP[block.pipelineColor] ? block.pipelineColor : DEFAULT_BLOCK_COLOR;
  const colorOptionsHtml = BLOCK_COLOR_OPTIONS.map(opt => `
    <button
      class="cb-color-dot${opt.id === colorId ? ' active' : ''}"
      type="button"
      data-color="${opt.id}"
      title="${opt.label}"
      style="--dot:${opt.value}"
    ></button>
  `).join('');

  el.innerHTML = `
    <div class="cb-header">
      <span class="cb-drag-icon">⠿</span>
      <span class="cb-spacer"></span>
      <button class="cb-btn color-btn" title="设置流水线颜色">●</button>
      <button class="cb-btn add-btn" title="加入/移出流水线">→</button>
      <button class="cb-btn more-btn" title="更多操作">⋯</button>
    </div>
    <div class="cb-color-menu hidden">${colorOptionsHtml}</div>
    <div class="cb-name" title="${esc(blockName)}">${esc(blockName)}</div>
    <div class="cb-editor-wrap hidden">
      <div class="cb-name-row">
        <label>块名称</label>
        <input class="cb-name-input" type="text" maxlength="60" placeholder="例如：角色设定" />
      </div>
      <div class="cb-format-toolbar"></div>
      <div class="cb-editor" contenteditable="true" data-placeholder="输入提示词内容…"></div>
      <div class="cb-editor-footer">
        <button class="btn" data-act="cancel-edit">取消</button>
        <button class="btn primary" data-act="save-edit">保存 (Ctrl+↵)</button>
      </div>
    </div>
    <div class="cb-resize-handles" aria-hidden="true">
      <span class="cb-resize-handle n" data-dir="n" title="向上调整"></span>
      <span class="cb-resize-handle s" data-dir="s" title="向下调整"></span>
      <span class="cb-resize-handle e" data-dir="e" title="向右调整"></span>
      <span class="cb-resize-handle w" data-dir="w" title="向左调整"></span>
      <span class="cb-resize-handle ne" data-dir="ne" title="右上角调整"></span>
      <span class="cb-resize-handle nw" data-dir="nw" title="左上角调整"></span>
      <span class="cb-resize-handle se" data-dir="se" title="右下角调整"></span>
      <span class="cb-resize-handle sw" data-dir="sw" title="左下角调整"></span>
    </div>
  `;

  // Mark add-btn if already in pipeline
  const addBtn = el.querySelector('.add-btn');
  if (blockInPipeline(block.id)) addBtn.classList.add('in-pipe');
  applyBlockColor(el, colorId);

  const colorBtn = el.querySelector('.color-btn');
  const colorMenu = el.querySelector('.cb-color-menu');
  colorBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelectorAll('.cb-color-menu').forEach(menu => {
      if (menu !== colorMenu) menu.classList.add('hidden');
    });
    colorMenu.classList.toggle('hidden');
  });

  colorMenu.addEventListener('click', async (e) => {
    const dot = e.target.closest('.cb-color-dot');
    if (!dot) return;
    const selected = dot.dataset.color;
    if (!BLOCK_COLOR_MAP[selected]) return;

    block.pipelineColor = selected;
    await DB.saveBlock(block);
    applyBlockColor(el, selected);
    colorMenu.classList.add('hidden');
    Render.pipeline();
  });

  // Header mousedown -> drag (unless clicking a button or inside editor)
  el.querySelector('.cb-header').addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (e.target.tagName === 'BUTTON') return;
    if (el.classList.contains('expanded')) return;
    BlockDrag.start(e, block.id, el);
  });

  // Add-to-pipeline button
  addBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (blockInPipeline(block.id)) {
      // Remove all occurrences from pipeline
      PipelineMgr.removeByBlockId(block.id);
    } else {
      PipelineMgr.add(block.id);
    }
    // Refresh button state
    const inP = blockInPipeline(block.id);
    addBtn.classList.toggle('in-pipe', inP);
    el.classList.toggle('in-pipeline', inP);
  });

  // More-options button -> block context menu
  el.querySelector('.more-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    colorMenu.classList.add('hidden');
    BlockCtxMenu.show(e.clientX, e.clientY, block.id);
  });

  // Right-click -> block context menu
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    colorMenu.classList.add('hidden');
    BlockCtxMenu.show(e.clientX, e.clientY, block.id);
  });

  // Double-click -> expand/edit
  el.querySelector('.cb-name').addEventListener('dblclick', (e) => {
    e.stopPropagation();
    BlockEdit.expand(block.id);
  });

  // Inline editor events
  const editorEl = el.querySelector('.cb-editor');
  const nameInput = el.querySelector('.cb-name-input');
  const editorWrap = el.querySelector('.cb-editor-wrap');
  const resizeHandles = el.querySelectorAll('.cb-resize-handle');

  // Ctrl+Enter to save; Escape to cancel
  editorEl.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault(); BlockEdit.save(block.id);
    }
    if (e.key === 'Escape') BlockEdit.collapse(block.id, false);
  });
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      BlockEdit.save(block.id);
    }
    if (e.key === 'Escape') BlockEdit.collapse(block.id, false);
  });

  el.querySelector('[data-act="save-edit"]').addEventListener('mousedown', (e) => {
    e.preventDefault(); BlockEdit.save(block.id);
  });
  el.querySelector('[data-act="cancel-edit"]').addEventListener('mousedown', (e) => {
    e.preventDefault(); BlockEdit.collapse(block.id, false);
  });

  // Prevent block drag while editor is open
  editorWrap.addEventListener('mousedown', (e) => e.stopPropagation());

  resizeHandles.forEach(handle => {
    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      BlockEdit.startResizeDrag(e, el, handle.dataset.dir);
    });
  });

  // Click to bring block to front
  el.addEventListener('mousedown', () => bringToFront(el));

  return el;
}

function renderBlock(block) {
  const existing = document.querySelector(`[data-block-id="${block.id}"]`);
  const newEl    = makeBlockEl(block);
  if (existing) {
    // Preserve z-index
    newEl.style.zIndex = existing.style.zIndex;
    existing.replaceWith(newEl);
  } else {
    document.getElementById('canvas-stage').appendChild(newEl);
  }
  return newEl;
}

function renderAllBlocks() {
  // Remove blocks not in S.blocks
  document.querySelectorAll('.canvas-block').forEach(el => {
    if (!S.blocks.find(b => b.id === el.dataset.blockId)) el.remove();
  });
  S.blocks.forEach(b => renderBlock(b));
  updateCanvasHint();
}

function updateCanvasHint() {
  const hint = document.getElementById('canvas-hint');
  if (S.blocks.length === 0) hint.classList.remove('hidden');
  else hint.classList.add('hidden');
}

async function normalizeActiveBlocksMeta() {
  for (let i = 0; i < S.blocks.length; i++) {
    const block = S.blocks[i];
    let dirty = false;

    if (!normalizeBlockName(block.name, '')) {
      block.name = `块 ${i + 1}`;
      dirty = true;
    }
    if (!BLOCK_COLOR_MAP[block.pipelineColor]) {
      block.pipelineColor = DEFAULT_BLOCK_COLOR;
      dirty = true;
    }

    if (dirty) {
      await DB.saveBlock(block);
    }
  }
}

/* =====================================================================
   9. BLOCK DRAG (canvas free-form movement)
   ===================================================================== */
const BlockDrag = {
  _d: null,

  start(e, blockId, el) {
    e.preventDefault();
    const block = S.blocks.find(b => b.id === blockId);
    if (!block) return;

    bringToFront(el);
    el.classList.add('is-dragging');

    BlockDrag._d = {
      blockId, el, block,
      mx: e.clientX, my: e.clientY,
      bx: block.x || 0, by: block.y || 0,
      moved: false,
      panel: document.getElementById('canvas-panel'),
      sl: document.getElementById('canvas-panel').scrollLeft,
      st: document.getElementById('canvas-panel').scrollTop,
    };

    document.addEventListener('mousemove', BlockDrag._move);
    document.addEventListener('mouseup',   BlockDrag._up);
  },

  _move(e) {
    const d = BlockDrag._d;
    if (!d) return;
    const dx = e.clientX - d.mx;
    const dy = e.clientY - d.my;
    if (!d.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    d.moved = true;

    const sdx = d.panel.scrollLeft - d.sl;
    const sdy = d.panel.scrollTop  - d.st;
    const nx  = Math.max(0, d.bx + dx + sdx);
    const ny  = Math.max(0, d.by + dy + sdy);

    d.block.x = nx; d.block.y = ny;
    d.el.style.left = nx + 'px';
    d.el.style.top  = ny + 'px';
  },

  _up() {
    const d = BlockDrag._d;
    if (!d) return;
    document.removeEventListener('mousemove', BlockDrag._move);
    document.removeEventListener('mouseup',   BlockDrag._up);
    d.el.classList.remove('is-dragging');
    if (d.moved) DB.saveBlock(d.block);
    BlockDrag._d = null;
  },
};

/* =====================================================================
   10. BLOCK INLINE EDITING
   ===================================================================== */
const BlockEdit = {
  _resizeObserver: null,
  _resizeFrame: 0,
  _resizeDrag: null,

  _persistSizeFromEl(el) {
    if (!el || !el.classList.contains('expanded')) return;
    const rect = el.getBoundingClientRect();
    if (!window.innerWidth || !window.innerHeight) return;

    const lPercent = (rect.left / window.innerWidth) * 100;
    const tPercent = (rect.top / window.innerHeight) * 100;
    const rPercent = (rect.right / window.innerWidth) * 100;
    const bPercent = (rect.bottom / window.innerHeight) * 100;
    EditorSizePref.writeRect({
      l: lPercent,
      t: tPercent,
      r: rPercent,
      b: bPercent,
    });
  },

  _observeResize(el) {
    BlockEdit._stopObserveResize();
    if (typeof ResizeObserver === 'undefined') return;

    BlockEdit._resizeObserver = new ResizeObserver(() => {
      if (BlockEdit._resizeFrame) return;
      BlockEdit._resizeFrame = requestAnimationFrame(() => {
        BlockEdit._resizeFrame = 0;
        BlockEdit._persistSizeFromEl(el);
      });
    });
    BlockEdit._resizeObserver.observe(el);
  },

  _stopObserveResize() {
    if (BlockEdit._resizeObserver) {
      BlockEdit._resizeObserver.disconnect();
      BlockEdit._resizeObserver = null;
    }
    if (BlockEdit._resizeFrame) {
      cancelAnimationFrame(BlockEdit._resizeFrame);
      BlockEdit._resizeFrame = 0;
    }
  },

  startResizeDrag(e, el, dir) {
    if (!el || !el.classList.contains('expanded')) return;
    if (!window.innerWidth || !window.innerHeight) return;
    if (!dir) return;

    BlockEdit._resizeUp();

    const rect = el.getBoundingClientRect();
    BlockEdit._resizeDrag = {
      el,
      dir,
      sx: e.clientX,
      sy: e.clientY,
      sl: rect.left,
      st: rect.top,
      sr: rect.right,
      sb: rect.bottom,
    };

    document.body.style.userSelect = 'none';
    const cursorMap = {
      n: 'n-resize',
      s: 's-resize',
      e: 'e-resize',
      w: 'w-resize',
      ne: 'nesw-resize',
      sw: 'nesw-resize',
      nw: 'nwse-resize',
      se: 'nwse-resize',
    };
    document.body.style.cursor = cursorMap[dir] || 'nwse-resize';
    document.addEventListener('mousemove', BlockEdit._resizeMove);
    document.addEventListener('mouseup', BlockEdit._resizeUp);
  },

  _resizeMove(e) {
    const d = BlockEdit._resizeDrag;
    if (!d) return;
    if (!window.innerWidth || !window.innerHeight) return;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const minW = (EditorSizePref.minW / 100) * vw;
    const maxW = (EditorSizePref.maxW / 100) * vw;
    const minH = (EditorSizePref.minH / 100) * vh;
    const maxH = (EditorSizePref.maxH / 100) * vh;

    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;

    let l = d.sl;
    let t = d.st;
    let r = d.sr;
    let b = d.sb;

    if (d.dir.includes('w')) l = d.sl + dx;
    if (d.dir.includes('e')) r = d.sr + dx;
    if (d.dir.includes('n')) t = d.st + dy;
    if (d.dir.includes('s')) b = d.sb + dy;

    if (d.dir.includes('w')) {
      l = clamp(l, Math.max(0, r - maxW), r - minW);
    }
    if (d.dir.includes('e')) {
      r = clamp(r, l + minW, Math.min(vw, l + maxW));
    }
    if (d.dir.includes('n')) {
      t = clamp(t, Math.max(0, b - maxH), b - minH);
    }
    if (d.dir.includes('s')) {
      b = clamp(b, t + minH, Math.min(vh, t + maxH));
    }

    l = clamp(l, 0, vw - minW);
    t = clamp(t, 0, vh - minH);
    r = clamp(r, l + minW, Math.min(vw, l + maxW));
    b = clamp(b, t + minH, Math.min(vh, t + maxH));

    const lPercent = Math.round((l / vw) * 1000) / 10;
    const tPercent = Math.round((t / vh) * 1000) / 10;
    const wPercent = Math.round(((r - l) / vw) * 1000) / 10;
    const hPercent = Math.round(((b - t) / vh) * 1000) / 10;

    d.el.style.left = `${lPercent}vw`;
    d.el.style.top = `${tPercent}vh`;
    d.el.style.width = `${wPercent}vw`;
    d.el.style.height = `${hPercent}vh`;
    d.el.style.transform = 'none';
  },

  _resizeUp() {
    const d = BlockEdit._resizeDrag;
    if (d) BlockEdit._persistSizeFromEl(d.el);
    document.removeEventListener('mousemove', BlockEdit._resizeMove);
    document.removeEventListener('mouseup', BlockEdit._resizeUp);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    BlockEdit._resizeDrag = null;
  },

  _applyExpandedRect(el) {
    const rect = EditorSizePref.readRect();
    el.style.position = 'fixed';
    el.style.width = `${rect.w}vw`;
    el.style.height = `${rect.h}vh`;
    el.style.left = `${rect.l}vw`;
    el.style.top = `${rect.t}vh`;
    el.style.transform = 'none';
  },

  expand(blockId) {
    // Collapse any previously expanded block (save it)
    if (_expandedId && _expandedId !== blockId) {
      BlockEdit.save(_expandedId, true);
    }
    _expandedId = blockId;

    const block = S.blocks.find(b => b.id === blockId);
    if (!block) return;
    const el = document.querySelector(`[data-block-id="${blockId}"]`);
    if (!el || el.classList.contains('expanded')) return;

    el.classList.add('expanded');
    BlockEdit._applyExpandedRect(el);
    BlockEdit._observeResize(el);
    bringToFront(el);
    el.querySelector('.cb-name').style.display = 'none';
    el.querySelector('.cb-editor-wrap').classList.remove('hidden');

    const nameInput = el.querySelector('.cb-name-input');
    const editor = el.querySelector('.cb-editor');
    nameInput.value = normalizeBlockName(block.name);
    editor.innerHTML = block.htmlContent || '';

    // Build toolbar once
    if (!el.dataset.tbBuilt) {
      buildFormatToolbar(el.querySelector('.cb-format-toolbar'), editor);
      el.dataset.tbBuilt = '1';
    }

    // Focus + cursor at end
    editor.focus();
    const r = document.createRange();
    r.selectNodeContents(editor);
    r.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  },

  collapse(blockId, doSave) {
    if (_expandedId === blockId) _expandedId = null;
    BlockEdit._resizeUp();
    BlockEdit._stopObserveResize();
    const el = document.querySelector(`[data-block-id="${blockId}"]`);
    if (!el || !el.classList.contains('expanded')) return;

    const block = S.blocks.find(b => b.id === blockId);
    const nameInput = el.querySelector('.cb-name-input');
    const editor = el.querySelector('.cb-editor');
    const name = nameInput ? normalizeBlockName(nameInput.value, '') : '';

    if (doSave) {
      const html   = editor ? editor.innerHTML.trim() : '';
      if (block && name && html && editor.textContent.trim()) {
        block.name = name;
        block.htmlContent = html;
        setBlockNameUI(el, name);
        DB.saveBlock(block);
        updateResult();
        Render.pipeline();
      }
    }

    el.classList.remove('expanded');
    el.style.width = '';
    el.style.height = '';
    el.style.position = '';
    el.style.transform = '';
    if (block) {
      el.style.left = `${block.x || 0}px`;
      el.style.top = `${block.y || 0}px`;
    }
    el.querySelector('.cb-name').style.display = '';
    el.querySelector('.cb-editor-wrap').classList.add('hidden');
  },

  async save(blockId, silent) {
    const el = document.querySelector(`[data-block-id="${blockId}"]`);
    if (!el) return;
    const nameInput = el.querySelector('.cb-name-input');
    const editor = el.querySelector('.cb-editor');
    const name = nameInput ? normalizeBlockName(nameInput.value, '') : '';
    const html   = editor ? editor.innerHTML.trim() : '';

    if (!name) {
      if (!silent) Toast.show('块名称不能为空');
      if (silent) {
        BlockEdit.collapse(blockId, false);
        return;
      }
      nameInput?.focus();
      return;
    }

    if (!editor || !editor.textContent.trim()) {
      if (!silent) Toast.show('块内容不能为空');
      if (silent) {
        BlockEdit.collapse(blockId, false);
        return;
      }
      editor?.focus();
      return;
    }

    const block = S.blocks.find(b => b.id === blockId);
    if (block) {
      block.name = name;
      block.htmlContent = html;
      await DB.saveBlock(block);
      setBlockNameUI(el, name);
      updateResult();
      Render.pipeline();
    }
    BlockEdit.collapse(blockId, false);
    if (!silent) Toast.show('已保存');
  },
};

