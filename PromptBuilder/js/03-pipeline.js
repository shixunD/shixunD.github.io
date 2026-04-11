'use strict';

/* =====================================================================
   11. PIPELINE MANAGEMENT
   ===================================================================== */
const PipelineMgr = {
  add(blockId) {
    const c = S.canvas;
    if (!c) return;
    c.pipeline = c.pipeline || [];
    c.pipeline.push({ itemId: uid(), blockId });
    DB.saveCanvas(c);
    Render.pipeline();
    updateResult();
  },

  removeByBlockId(blockId) {
    const c = S.canvas;
    if (!c || !c.pipeline) return;
    c.pipeline = c.pipeline.filter(i => i.blockId !== blockId);
    DB.saveCanvas(c);
    Render.pipeline();
    updateResult();
    // Update block card indicator
    const el = document.querySelector(`[data-block-id="${blockId}"]`);
    if (el) {
      el.classList.remove('in-pipeline');
      el.querySelector('.add-btn')?.classList.remove('in-pipe');
    }
  },

  removeItem(itemId) {
    const c = S.canvas;
    if (!c || !c.pipeline) return;
    const item = c.pipeline.find(i => i.itemId === itemId);
    if (!item) return;
    c.pipeline = c.pipeline.filter(i => i.itemId !== itemId);
    DB.saveCanvas(c);
    Render.pipeline();
    updateResult();
    // Check if block still has other pipeline refs
    if (!blockInPipeline(item.blockId)) {
      const el = document.querySelector(`[data-block-id="${item.blockId}"]`);
      if (el) {
        el.classList.remove('in-pipeline');
        el.querySelector('.add-btn')?.classList.remove('in-pipe');
      }
    }
  },

  reorder(fromItemId, toItemId, before) {
    const c = S.canvas;
    if (!c || !c.pipeline) return;
    const fromIdx = c.pipeline.findIndex(i => i.itemId === fromItemId);
    const [moved] = c.pipeline.splice(fromIdx, 1);
    let toIdx = c.pipeline.findIndex(i => i.itemId === toItemId);
    if (!before) toIdx++;
    c.pipeline.splice(toIdx, 0, moved);
    DB.saveCanvas(c);
    Render.pipeline();
    updateResult();
  },

  clear() {
    const c = S.canvas;
    if (!c) return;
    const oldPipeline = c.pipeline || [];
    c.pipeline = [];
    DB.saveCanvas(c);
    // Reset block indicators
    oldPipeline.forEach(item => {
      const el = document.querySelector(`[data-block-id="${item.blockId}"]`);
      if (el) {
        el.classList.remove('in-pipeline');
        el.querySelector('.add-btn')?.classList.remove('in-pipe');
      }
    });
    Render.pipeline();
    updateResult();
  },

  addBlockToPipelineByDrop(blockId) {
    if (!blockInPipeline(blockId)) {
      PipelineMgr.add(blockId);
      const el = document.querySelector(`[data-block-id="${blockId}"]`);
      if (el) {
        el.classList.add('in-pipeline');
        el.querySelector('.add-btn')?.classList.add('in-pipe');
      }
    }
  },
};

/* =====================================================================
   12. PIPELINE DRAG & DROP (reordering within pipeline)
   ===================================================================== */
const PipelineDnD = {
  _dragging: null,

  start(e, itemId) {
    PipelineDnD._dragging = itemId;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('pipelineItemId', itemId);
    e.currentTarget.classList.add('dragging');
  },

  over(e, itemId) {
    e.preventDefault();
    if (itemId === PipelineDnD._dragging) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const cls  = e.clientY < rect.top + rect.height / 2 ? 'drop-above' : 'drop-below';
    document.querySelectorAll('.pipeline-item').forEach(el => el.classList.remove('drop-above', 'drop-below'));
    e.currentTarget.classList.add(cls);
  },

  leave(e) {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      e.currentTarget.classList.remove('drop-above', 'drop-below');
    }
  },

  drop(e, toItemId) {
    e.preventDefault();
    const fromId = PipelineDnD._dragging;
    if (!fromId || fromId === toItemId) return;
    const rect   = e.currentTarget.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    PipelineMgr.reorder(fromId, toItemId, before);
  },

  end(e) {
    e.currentTarget.classList.remove('dragging');
    document.querySelectorAll('.drop-above,.drop-below').forEach(el => el.classList.remove('drop-above', 'drop-below'));
    PipelineDnD._dragging = null;
  },
};

/* =====================================================================
   13. RESULT PANEL
   ===================================================================== */
function updateResult() {
  const c       = S.canvas;
  const el      = document.getElementById('result-content');
  const pipeline = (c && c.pipeline) || [];

  if (pipeline.length === 0) {
    el.innerHTML = '<span class="result-empty">流水线为空</span>';
    return;
  }

  const parts = pipeline.map(item => {
    const block = S.blocks.find(b => b.id === item.blockId);
    return block ? `<div class="result-seg">${block.htmlContent || ''}</div>` : '';
  }).filter(Boolean);

  if (parts.length === 0) {
    el.innerHTML = '<span class="result-empty">块内容为空</span>';
  } else {
    el.innerHTML = parts.join('<hr class="result-sep">');
  }
}

