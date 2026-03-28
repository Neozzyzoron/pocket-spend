/* ═══════════════════════════════════════════════════════════════
   categories.js — Categories page
   Full category management: groups, subcategories, drag reorder
═══════════════════════════════════════════════════════════════ */

import {
  escHtml, buildCategoryTree, wireDragReorder,
} from './utils.js';
import { openCategoryModal } from './settings.js';

// Persists collapse state within the session
const collapsedGroups = new Set();

// ── MAIN RENDER ───────────────────────────────────────────────
export function render(state) {
  const el = document.getElementById('page-categories');
  const { categories } = state;
  const { groups, subsByParent } = buildCategoryTree(categories);

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Categories</div>
        <div class="page-subtitle">${groups.length} group${groups.length !== 1 ? 's' : ''} · ${categories.filter(c => c.parent_id).length} subcategories</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-danger btn-sm hidden" id="cat-delete-sel">Delete selected</button>
        <button class="btn btn-primary" id="cat-add-group-btn">+ Add group</button>
      </div>
    </div>

    <div class="section">
      <div class="card" style="padding:0">
        ${groups.length === 0 ? `<div class="empty-state">No categories yet. Add a group to get started.</div>` :
          `<div id="cat-groups-list">` +
          groups.map(g => {
            const subs = subsByParent[g.id] || [];
            const isCollapsed = collapsedGroups.has(g.id);
            return `<div class="cat-group-row" data-id="${g.id}" style="border-bottom:1px solid var(--border)">
              <div class="flex items-center justify-between" style="padding:.65rem 1rem">
                <div class="flex items-center gap-2" style="cursor:pointer;flex:1" data-collapse-toggle="${g.id}">
                  <input type="checkbox" class="cat-page-cb" data-id="${g.id}" onclick="event.stopPropagation()" style="flex-shrink:0" />
                  <span class="drag-handle" style="cursor:grab;color:var(--text-muted);font-size:1rem;user-select:none" onclick="event.stopPropagation()">⠿</span>
                  <span class="cat-collapse-chevron text-muted" style="font-size:.75rem;width:1rem;text-align:center;transition:transform .15s">${isCollapsed ? '▸' : '▾'}</span>
                  <span style="font-size:1.1rem">${escHtml(g.icon || '')}</span>
                  ${g.color ? `<span style="width:.6rem;height:.6rem;border-radius:50%;background:${escHtml(g.color)};flex-shrink:0;display:inline-block"></span>` : ''}
                  <div>
                    <div class="fw-500">${escHtml(g.name)}</div>
                    <div class="text-sm text-muted">${g.nature || '—'} · ${subs.length} subcategor${subs.length === 1 ? 'y' : 'ies'}</div>
                  </div>
                </div>
                <div class="flex gap-1">
                  <button class="btn btn-ghost btn-sm cat-edit-btn" data-id="${g.id}">Edit</button>
                  <button class="btn btn-ghost btn-sm cat-add-sub-btn" data-id="${g.id}">+ Sub</button>
                  <button class="btn btn-ghost btn-sm btn-danger cat-delete-btn" data-id="${g.id}">✕</button>
                </div>
              </div>
              <div class="cat-subs-list${isCollapsed ? ' hidden' : ''}" data-parent="${g.id}">
                ${subs.map(s => `<div class="cat-sub-row" data-id="${s.id}" style="padding:.5rem 1rem .5rem 2.5rem;border-top:1px solid var(--border)40">
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                      <input type="checkbox" class="cat-page-cb" data-id="${s.id}" style="flex-shrink:0" />
                      <span class="drag-handle" style="cursor:grab;color:var(--text-muted);font-size:1rem;user-select:none">⠿</span>
                      <span>${escHtml(s.icon || '')}</span>
                      ${s.color ? `<span style="width:.5rem;height:.5rem;border-radius:50%;background:${escHtml(s.color)};flex-shrink:0;display:inline-block"></span>` : ''}
                      <span class="text-sm">${escHtml(s.name)}</span>
                      <span class="badge badge-neutral text-xs">${s.nature || ''}</span>
                    </div>
                    <div class="flex gap-1">
                      <button class="btn btn-ghost btn-sm cat-edit-btn" data-id="${s.id}">Edit</button>
                      <button class="btn btn-ghost btn-sm btn-danger cat-delete-btn" data-id="${s.id}">✕</button>
                    </div>
                  </div>
                </div>`).join('')}
              </div>
            </div>`;
          }).join('') + `</div>`
        }
      </div>
    </div>
  `;

  wire(state);
}

// ── WIRE ──────────────────────────────────────────────────────
function wire(state) {
  const el = document.getElementById('page-categories');

  // Drag reorder — groups
  wireDragReorder(
    document.getElementById('cat-groups-list'),
    '.cat-group-row[data-id]',
    ids => saveCatOrder(ids, state)
  );

  // Drag reorder — subs within each group
  el.querySelectorAll('.cat-subs-list[data-parent]').forEach(list => {
    wireDragReorder(list, '.cat-sub-row[data-id]', ids => saveCatOrder(ids, state));
  });

  // Collapse/expand
  el.querySelectorAll('[data-collapse-toggle]').forEach(header => {
    header.addEventListener('click', () => {
      const id = header.dataset.collapseToggle;
      const subsList = el.querySelector(`.cat-subs-list[data-parent="${id}"]`);
      const chevron  = header.querySelector('.cat-collapse-chevron');
      if (!subsList) return;
      const closing = !subsList.classList.contains('hidden');
      subsList.classList.toggle('hidden', closing);
      if (chevron) chevron.textContent = closing ? '▸' : '▾';
      if (closing) collapsedGroups.add(id); else collapsedGroups.delete(id);
    });
  });

  // Add group
  document.getElementById('cat-add-group-btn')?.addEventListener('click', () => openCategoryModal(state));

  // Edit
  el.querySelectorAll('.cat-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cat = state.categories.find(c => c.id === btn.dataset.id);
      if (cat) openCategoryModal(state, cat);
    });
  });

  // Add sub
  el.querySelectorAll('.cat-add-sub-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const parent = state.categories.find(c => c.id === btn.dataset.id);
      openCategoryModal(state, null, parent);
    });
  });

  // Delete single
  el.querySelectorAll('.cat-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ok = await App.openConfirm('Delete category', 'Transactions using this category will become uncategorised.');
      if (!ok) return;
      const { error } = await App.supabase.from('categories').delete()
        .eq('id', btn.dataset.id).eq('household_id', App.state.household.id);
      if (!error) {
        state.categories = state.categories.filter(c => c.id !== btn.dataset.id);
        App.toast('Category deleted', 'success');
        render(state);
      } else {
        App.toast('Error: ' + error.message, 'error');
      }
    });
  });

  // Mass select / delete
  const delBtn  = document.getElementById('cat-delete-sel');
  const getCbs  = () => [...el.querySelectorAll('.cat-page-cb')];

  const updateDelBtn = () => {
    const checked = getCbs().filter(c => c.checked);
    delBtn?.classList.toggle('hidden', checked.length === 0);
    if (delBtn) delBtn.textContent = `Delete selected (${checked.length})`;
  };

  getCbs().forEach(cb => cb.addEventListener('change', updateDelBtn));

  delBtn?.addEventListener('click', async () => {
    const ids = getCbs().filter(c => c.checked).map(c => c.dataset.id);
    if (!ids.length) return;
    const ok = await App.openConfirm('Delete selected', `Permanently delete ${ids.length} categor${ids.length > 1 ? 'ies' : 'y'}?`);
    if (!ok) return;
    await Promise.all(ids.map(id =>
      App.supabase.from('categories').delete().eq('id', id).eq('household_id', App.state.household.id)
    ));
    state.categories = state.categories.filter(c => !ids.includes(c.id));
    App.toast(`Deleted ${ids.length} categor${ids.length > 1 ? 'ies' : 'y'}`, 'success');
    render(state);
  });
}

// ── HELPERS ───────────────────────────────────────────────────
async function saveCatOrder(ids, state) {
  await Promise.all(ids.map((id, i) =>
    App.supabase.from('categories')
      .update({ sort_order: i * 10 }).eq('id', id).eq('household_id', App.state.household.id)
  ));
  ids.forEach((id, i) => {
    const c = state.categories.find(c => c.id === id);
    if (c) c.sort_order = i * 10;
  });
  App.toast('Order saved', 'success');
}
