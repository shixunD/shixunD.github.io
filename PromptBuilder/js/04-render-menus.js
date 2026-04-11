'use strict';

/* =====================================================================
   14. RENDER
   ===================================================================== */
const Render = {
  sidebar() {
    const list = document.getElementById('canvas-list');
    list.innerHTML = '';
    if (S.canvases.length === 0) {
      list.innerHTML = '<div id="sidebar-empty"><p>还没有 Canvas<br>点击 <strong>+</strong> 新建</p></div>';
      return;
    }
    S.canvases.forEach(c => {
      const li = document.createElement('li');
      li.className = 'canvas-item' + (c.id === S.activeCanvasId ? ' active' : '');
      li.innerHTML = `<span class="canvas-item-icon">▤</span>
        <span class="canvas-item-name" title="${esc(c.name)}">${esc(c.name)}</span>`;
      li.addEventListener('click', () => Actions.selectCanvas(c.id));
      list.appendChild(li);
    });
  },

  header() {
    const hdr  = document.getElementById('canvas-header');
    const name = document.getElementById('canvas-name');
    const desc = document.getElementById('canvas-desc');
    const c    = S.canvas;
    if (!c) {
      hdr.classList.add('no-canvas');
      name.textContent = '未选择 Canvas';
      name.className = 'placeholder';
      desc.textContent = '';
    } else {
      hdr.classList.remove('no-canvas');
      name.textContent = c.name;
      name.className = '';
      desc.textContent = c.description || '';
    }
  },

  pipeline() {
    const list = document.getElementById('pipeline-list');
    const empty = document.getElementById('pipeline-empty');
    const c = S.canvas;
    const pipeline = (c && c.pipeline) || [];

    // Clear existing items (not the empty message div)
    list.querySelectorAll('.pipeline-item').forEach(el => el.remove());

    if (pipeline.length === 0) {
      if (empty) empty.style.display = '';
      return;
    }
    if (empty) empty.style.display = 'none';

    pipeline.forEach((item, idx) => {
      const block = S.blocks.find(b => b.id === item.blockId);
      const blockName = block ? normalizeBlockName(block.name) : '(已删除)';
      const color = block ? blockColorValue(block.pipelineColor) : '#868e96';

      const li = document.createElement('li');
      li.className = 'pipeline-item';
      li.draggable = true;
      li.dataset.itemId = item.itemId;
      li.innerHTML = `
        <span class="pi-drag">⠿</span>
        <span class="pi-num">${idx + 1}</span>
        <span class="pi-color" style="--c:${color}"></span>
        <span class="pi-text" title="${esc(blockName)}">${esc(blockName)}</span>
        <button class="pi-del" title="移除">×</button>
      `;

      li.addEventListener('dragstart', (e) => PipelineDnD.start(e, item.itemId));
      li.addEventListener('dragover',  (e) => PipelineDnD.over(e, item.itemId));
      li.addEventListener('dragleave', (e) => PipelineDnD.leave(e));
      li.addEventListener('drop',      (e) => PipelineDnD.drop(e, item.itemId));
      li.addEventListener('dragend',   (e) => PipelineDnD.end(e));
      li.querySelector('.pi-del').addEventListener('click', () => PipelineMgr.removeItem(item.itemId));

      list.insertBefore(li, empty);
    });
  },
};

function esc(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* =====================================================================
   15. CONTEXT MENUS
   ===================================================================== */
// Canvas empty-area context menu
const CanvasCtxMenu = {
  show(x, y) {
    const m = document.getElementById('canvas-ctx-menu');
    m.classList.remove('hidden');
    posCtxMenu(m, x, y);
  },
  hide() { document.getElementById('canvas-ctx-menu').classList.add('hidden'); },
};

// Block context menu
const BlockCtxMenu = {
  _id: null,
  show(x, y, blockId) {
    BlockCtxMenu._id = blockId;
    const m = document.getElementById('block-ctx-menu');
    const sendItem = m.querySelector('[data-action="send-to-canvas"]');
    if (sendItem) {
      sendItem.style.display = blockInPipeline(blockId) ? '' : 'none';
    }
    m.classList.remove('hidden');
    posCtxMenu(m, x, y);
  },
  hide() {
    document.getElementById('block-ctx-menu').classList.add('hidden');
    BlockCtxMenu._id = null;
  },
};

const DataCtxMenu = {
  show(anchorEl) {
    const m = document.getElementById('data-ctx-menu');
    if (!m || !anchorEl) return;
    m.classList.remove('hidden');
    const rect = anchorEl.getBoundingClientRect();
    posCtxMenu(m, rect.right - 4, rect.bottom + 6);
  },

  toggle(anchorEl) {
    const m = document.getElementById('data-ctx-menu');
    if (!m) return;
    if (m.classList.contains('hidden')) DataCtxMenu.show(anchorEl);
    else DataCtxMenu.hide();
  },

  hide() {
    document.getElementById('data-ctx-menu')?.classList.add('hidden');
  },
};

function posCtxMenu(m, x, y) {
  m.style.left = '0'; m.style.top = '0';
  requestAnimationFrame(() => {
    m.style.left = Math.min(x, window.innerWidth  - m.offsetWidth  - 6) + 'px';
    m.style.top  = Math.min(y, window.innerHeight - m.offsetHeight - 6) + 'px';
  });
}

function hideAllColorMenus() {
  document.querySelectorAll('.cb-color-menu').forEach(menu => menu.classList.add('hidden'));
}

function hideAllMenus() {
  CanvasCtxMenu.hide();
  BlockCtxMenu.hide();
  DataCtxMenu.hide();
  hideAllColorMenus();
}

/* =====================================================================
   16. DIALOG (new canvas / rename)
   ===================================================================== */
let _dlgMode = null;
let _sendBlockId = null;

function showDialog(mode, existing) {
  _dlgMode = mode;
  document.getElementById('dialog-title').textContent =
    mode === 'new-canvas' ? '新建 Canvas' : '重命名 Canvas';
  document.getElementById('dlg-name').value = existing ? existing.name  : '';
  document.getElementById('dlg-desc').value = existing ? (existing.description || '') : '';
  document.getElementById('dialog-overlay').classList.remove('hidden');
  document.getElementById('dlg-name').focus();
  document.getElementById('dlg-name').select();
}
function hideDialog() {
  document.getElementById('dialog-overlay').classList.add('hidden');
}

function showSendDialog(blockId) {
  const block = S.blocks.find(b => b.id === blockId);
  if (!block) {
    Toast.show('块不存在');
    return;
  }

  const targets = S.canvases.filter(c => c.id !== S.activeCanvasId);
  if (targets.length === 0) {
    Toast.show('没有可发送的目标 Canvas');
    return;
  }

  _sendBlockId = blockId;

  const sel = document.getElementById('send-target-canvas');
  sel.innerHTML = '';
  targets.forEach(c => {
    const op = document.createElement('option');
    op.value = c.id;
    op.textContent = c.name;
    sel.appendChild(op);
  });

  document.getElementById('send-overlay').classList.remove('hidden');
  sel.focus();
}

function hideSendDialog() {
  document.getElementById('send-overlay').classList.add('hidden');
  _sendBlockId = null;
}

