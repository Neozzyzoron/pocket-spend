/* ═══════════════════════════════════════════════════════════════
   settings.js — Settings page
   Sections: Household, Display, Theme, Accounts, Categories, Recurring, Account
═══════════════════════════════════════════════════════════════ */

import {
  fmtCurrency, escHtml, effectiveType, calcAccountBalance,
  buildCategoryTree, isEffective,
} from './utils.js';

// ── ICON PICKER DATA ──────────────────────────────────────────
const CURATED_ICONS = {
  'Food & Drink':  ['🍔','🍕','🍜','🥗','🍺','☕','🍰','🥩','🍱','🍣','🍦','🥤','🍷','🍳','🥐','🧁','🫕','🥘'],
  'Transport':     ['🚗','🚇','✈️','🚕','🚲','⛽','🚌','🛵','🚂','🛻','🏍️','🚁','🅿️','🛳️'],
  'Shopping':      ['👗','👟','📱','💻','🛍️','💄','👔','📷','🕶️','👜','🧴','🪥','🧣','🛒'],
  'Health':        ['💊','🏥','🦷','👓','🏃','🩺','💉','🏋️','🧘','🚿','💆','🩹'],
  'Home & Garden': ['🏠','🔧','💡','🛋️','🧹','🌿','🔑','🪴','🪑','🛏️','🪟','🔨'],
  'Entertainment': ['🎬','🎵','🎮','📺','🎯','🎭','🎨','🎸','🎧','🎲','🎪','🎻'],
  'Finance':       ['💰','💳','🏦','📈','💹','🏧','💵','📊','🪙','💸','📉','💎'],
  'Education':     ['📚','🎓','✏️','🖊️','📝','🔬','📐','🖋️','📖','🗒️'],
  'Travel':        ['🏖️','⛷️','🏕️','🗺️','🏔️','🌊','🗽','🌍','🌴','⛰️'],
  'Utilities':     ['💧','⚡','📞','🌐','🔌','📡','♻️','🗑️'],
  'Kids & Family': ['🧸','🎠','🎒','🎡','🧩','🪀','🎈','🍼','🧒','🎨'],
  'Pets':          ['🐕','🐈','🦮','🐾','🐟','🐇','🐹','🐠'],
};

const EMOJI_CATS = {
  'Smileys':  ['😀','😃','😄','😁','😅','🤣','😂','🙂','😊','😇','🥰','😍','🤩','😘','😋','😛','😜','🤪','😎','🥳'],
  'People':   ['👋','✋','🤝','💪','👍','👎','✌️','🤞','🤟','🤙','🙌','👏','🙏','👐','🤲','👑','🧑','👨','👩','🧒'],
  'Animals':  ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐸','🐵','🐔','🐧','🦋','🐝','🌸','🌺','🦜'],
  'Food':     ['🍏','🍎','🍊','🍋','🍇','🍓','🫐','🍒','🍑','🥝','🍅','🥥','🥑','🌽','🌶️','🍆','🥔','🧄','🧅','🥕'],
  'Places':   ['🏠','🏡','🏢','🏥','🏦','🏨','🏪','🏫','⛪','🕌','🗼','🗽','⛩️','🏰','🌋','⛺','🚉','🚢','⛵','🗺️'],
  'Objects':  ['⌚','📱','💻','⌨️','🖥️','📷','📸','📺','📻','🎙️','💡','🔦','🕯️','🔨','⚔️','🛡️','🔧','🔩','⚙️','🔑'],
  'Symbols':  ['❤️','🧡','💛','💚','💙','💜','🖤','⭐','🌟','💫','✨','🔥','🌈','☀️','🌙','⚡','❄️','🌊','🍀','🎄'],
};

function _ipGridHtml(icons) {
  return icons.map(ic =>
    `<button type="button" class="ip-btn" data-icon="${escHtml(ic)}"
      style="width:2rem;height:2rem;font-size:1.2rem;border:none;background:none;cursor:pointer;
             border-radius:4px;padding:0;line-height:1;display:flex;align-items:center;justify-content:center">${ic}</button>`
  ).join('');
}

function _ipSectionHtml(dict) {
  return Object.entries(dict).map(([cat, icons]) =>
    `<div style="margin-bottom:.6rem">
      <div style="font-size:.65rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;
                  margin-bottom:.2rem;padding:0 .15rem">${cat}</div>
      <div style="display:flex;flex-wrap:wrap;gap:1px">${_ipGridHtml(icons)}</div>
    </div>`
  ).join('');
}

function buildIconPickerHtml() {
  return `
    <div id="cf-icon-picker" class="hidden" style="border:1px solid var(--border);border-radius:var(--radius);
         margin-bottom:1rem;overflow:hidden">
      <div style="border-bottom:1px solid var(--border);padding:.4rem .5rem;display:flex;align-items:center;
                  gap:.4rem;background:var(--bg-subtle)">
        <button type="button" class="btn btn-sm btn-primary ip-tab" data-tab="curated" style="flex-shrink:0">🎨 Curated</button>
        <button type="button" class="btn btn-sm btn-ghost ip-tab" data-tab="emoji" style="flex-shrink:0">😀 Emoji</button>
        <input type="text" id="cf-icon-search" placeholder="Search…"
               style="flex:1;padding:.25rem .5rem;border:1px solid var(--border);border-radius:var(--radius-sm);
                      background:var(--bg-input);color:var(--text);font-size:.8rem;min-width:0" />
        <button type="button" id="cf-icon-clear" class="btn btn-ghost btn-sm" style="flex-shrink:0"
                title="Clear icon">✕</button>
      </div>
      <div id="cf-icon-grid" style="max-height:190px;overflow-y:auto;padding:.5rem">
        <div id="ip-tab-curated">${_ipSectionHtml(CURATED_ICONS)}</div>
        <div id="ip-tab-emoji" class="hidden">${_ipSectionHtml(EMOJI_CATS)}</div>
        <div id="ip-search-results" class="hidden"></div>
      </div>
    </div>`;
}

function wireIconPicker() {
  const toggleBtn = document.getElementById('cf-icon-btn');
  const picker    = document.getElementById('cf-icon-picker');
  const hidden    = document.getElementById('cf-icon');
  const preview   = document.getElementById('cf-icon-preview');
  const searchEl  = document.getElementById('cf-icon-search');
  const clearBtn  = document.getElementById('cf-icon-clear');
  if (!toggleBtn || !picker) return;

  const selectIcon = (icon) => {
    hidden.value        = icon;
    preview.textContent = icon;
    toggleBtn.title     = icon;
    picker.classList.add('hidden');
  };

  const wireButtons = (root) => {
    root.querySelectorAll('.ip-btn').forEach(b => {
      b.addEventListener('click', () => selectIcon(b.dataset.icon));
    });
  };

  toggleBtn.addEventListener('click', () => {
    picker.classList.toggle('hidden');
    if (!picker.classList.contains('hidden')) searchEl?.focus();
  });

  picker.querySelectorAll('.ip-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      picker.querySelectorAll('.ip-tab').forEach(t => {
        t.classList.remove('btn-primary');
        t.classList.add('btn-ghost');
      });
      tab.classList.add('btn-primary');
      tab.classList.remove('btn-ghost');
      const which = tab.dataset.tab;
      document.getElementById('ip-tab-curated').classList.toggle('hidden', which !== 'curated');
      document.getElementById('ip-tab-emoji').classList.toggle('hidden', which !== 'emoji');
      document.getElementById('ip-search-results').classList.add('hidden');
      if (searchEl) searchEl.value = '';
    });
  });

  searchEl?.addEventListener('input', () => {
    const q = searchEl.value.trim().toLowerCase();
    const resultsEl = document.getElementById('ip-search-results');
    const curatedEl = document.getElementById('ip-tab-curated');
    const emojiEl   = document.getElementById('ip-tab-emoji');
    if (!q) {
      resultsEl.classList.add('hidden');
      const activeTab = picker.querySelector('.ip-tab.btn-primary')?.dataset.tab || 'curated';
      curatedEl.classList.toggle('hidden', activeTab !== 'curated');
      emojiEl.classList.toggle('hidden', activeTab !== 'emoji');
      return;
    }
    curatedEl.classList.add('hidden');
    emojiEl.classList.add('hidden');
    resultsEl.classList.remove('hidden');

    const all = [
      ...Object.entries(CURATED_ICONS).flatMap(([cat, icons]) => icons.map(ic => ({ ic, cat }))),
      ...Object.entries(EMOJI_CATS).flatMap(([cat, icons]) => icons.map(ic => ({ ic, cat }))),
    ];
    const matches = all.filter(({ cat }) => cat.toLowerCase().includes(q));
    resultsEl.innerHTML = matches.length
      ? `<div style="display:flex;flex-wrap:wrap;gap:1px">${_ipGridHtml(matches.map(m => m.ic))}</div>`
      : `<div class="text-muted text-sm" style="padding:.5rem">No matches for "${escHtml(q)}"</div>`;
    wireButtons(resultsEl);
  });

  clearBtn?.addEventListener('click', () => {
    hidden.value        = '';
    preview.textContent = '';
    toggleBtn.title     = 'Pick icon';
    picker.classList.add('hidden');
  });

  wireButtons(picker);
}

// ── MAIN RENDER ───────────────────────────────────────────────
export function render(state) {
  const el = document.getElementById('page-settings');

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Settings</div>
        <div class="page-subtitle">Household · Display · Theme · Accounts · Categories</div>
      </div>
    </div>

    ${renderHouseholdSection(state)}
    ${renderDisplaySection(state)}
    ${renderThemeSection(state)}
    ${renderAccountsSection(state)}
    ${renderCategoriesSection(state)}
    ${renderRecurringSection(state)}
    ${renderAccountSection(state)}
  `;

  wireHousehold(state);
  wireDisplay(state);
  wireTheme(state);
  wireAccountsSection(state);
  wireCategoriesSection(state);
  wireRecurringSection(state);
}

// ── 1. HOUSEHOLD ──────────────────────────────────────────────
function renderHouseholdSection(state) {
  const h = state.household;
  const members = state.profiles;
  return `<div class="section">
    <div class="section-header"><div class="section-title">Household</div></div>
    <div class="card">
      <div class="form-row">
        <div class="form-group" style="flex:1">
          <label class="form-label">Household name</label>
          <input class="form-input" id="hh-name" value="${escHtml(h?.name || '')}" />
        </div>
        <div class="form-group" style="flex:1">
          <label class="form-label">Currency symbol</label>
          <input class="form-input" id="hh-currency" value="${escHtml(h?.currency || 'Kč')}" maxlength="5" style="max-width:100px" />
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Invite code</label>
        <div class="flex gap-2 items-center">
          <span class="text-mono fw-600" style="letter-spacing:.15em;font-size:1.1rem">${escHtml(h?.invite_code || '—')}</span>
          <button class="btn btn-ghost btn-sm" id="hh-copy-code">Copy</button>
        </div>
        <div class="form-hint">Share this code with your household partner</div>
      </div>
      <div class="form-group">
        <label class="form-label">Members</label>
        <div class="flex gap-2" style="flex-wrap:wrap">
          ${members.map(p => `<div class="chip">${escHtml(p.display_name)}</div>`).join('')}
        </div>
      </div>
      <button class="btn btn-primary" id="hh-save-btn">Save household</button>
    </div>
  </div>`;
}

function wireHousehold(state) {
  document.getElementById('hh-copy-code')?.addEventListener('click', () => {
    navigator.clipboard.writeText(state.household?.invite_code || '').then(() => App.toast('Code copied', 'success'));
  });

  document.getElementById('hh-save-btn')?.addEventListener('click', async () => {
    const name = document.getElementById('hh-name')?.value.trim();
    const currency = document.getElementById('hh-currency')?.value.trim();
    if (!name) { App.toast('Name required', 'error'); return; }

    const { error } = await App.supabase.from('households')
      .update({ name, currency }).eq('id', state.household.id);
    if (!error) {
      state.household.name = name;
      state.household.currency = currency;
      App.renderUserPill();
      App.toast('Household saved', 'success');
    } else {
      App.toast('Error: ' + error.message, 'error');
    }
  });
}

// ── 2. DISPLAY ────────────────────────────────────────────────
function renderDisplaySection(state) {
  const { profiles, prefs } = state;
  const userA = profiles[0];
  const userB = profiles[1];
  const myPrefs = state.prefs;
  const myProfile = state.profile;

  const navOrder = prefs.nav_order || ['dashboard','transactions','budgets','analytics','forecast','recurring','accounts','settings'];
  const navLabels = { dashboard:'Dashboard', transactions:'Transactions', budgets:'Budgets',
                      analytics:'Analytics', forecast:'Forecast', recurring:'Recurring',
                      accounts:'Accounts', settings:'Settings' };

  return `<div class="section">
    <div class="section-header"><div class="section-title">Display</div></div>
    <div class="card">
      <div class="form-row">
        <div class="form-group" style="flex:1">
          <label class="form-label">${userA ? escHtml(userA.display_name) : 'User A'} salary day</label>
          <input class="form-input" type="number" id="disp-salary-a" min="1" max="31" value="${userA?.preferences?.salary_day || ''}" placeholder="1–31" style="max-width:80px" />
        </div>
        ${userB ? `<div class="form-group" style="flex:1">
          <label class="form-label">${escHtml(userB.display_name)} salary day</label>
          <input class="form-input" type="number" id="disp-salary-b" min="1" max="31" value="${userB?.preferences?.salary_day || ''}" placeholder="1–31" style="max-width:80px" />
        </div>` : ''}
      </div>
      <button class="btn btn-primary btn-sm" id="disp-save-salary">Save salary days</button>

      <div class="divider" style="margin:1.25rem 0"></div>
      <div class="form-group">
        <label class="form-label">Navigation order</label>
        <div class="form-hint">Drag to reorder (not yet interactive — edit order below)</div>
        <div id="nav-order-list" style="margin-top:.5rem">
          ${navOrder.map((page, i) => `<div class="flex items-center gap-2" style="padding:.35rem 0;border-bottom:1px solid var(--border)">
            <span class="drag-handle text-muted">⠿</span>
            <span>${navLabels[page] || page}</span>
          </div>`).join('')}
        </div>
      </div>
    </div>
  </div>`;
}

function wireDisplay(state) {
  document.getElementById('disp-save-salary')?.addEventListener('click', async () => {
    const sdA = parseInt(document.getElementById('disp-salary-a')?.value) || null;
    const sdB = parseInt(document.getElementById('disp-salary-b')?.value) || null;

    // Save to each profile
    const profiles = state.profiles;
    const updates = [];

    if (profiles[0]) {
      const prefs = { ...(profiles[0].preferences || {}), salary_day: sdA };
      updates.push(App.supabase.from('profiles').update({ preferences: prefs }).eq('id', profiles[0].id));
    }
    if (profiles[1] && document.getElementById('disp-salary-b')) {
      const prefs = { ...(profiles[1].preferences || {}), salary_day: sdB };
      updates.push(App.supabase.from('profiles').update({ preferences: prefs }).eq('id', profiles[1].id));
    }

    await Promise.all(updates);
    // Update local state
    if (profiles[0]) profiles[0].preferences = { ...(profiles[0].preferences || {}), salary_day: sdA };
    if (profiles[1] && document.getElementById('disp-salary-b')) profiles[1].preferences = { ...(profiles[1].preferences || {}), salary_day: sdB };

    App.renderCycleToggle();
    App.toast('Salary days saved', 'success');
  });
}

// ── 3. THEME ──────────────────────────────────────────────────
const DEFAULT_THEME = { bg: '#faf7f2', text: '#1c1917', accent: '#22c55e' };

const BG_PRESETS = [
  { label: 'Cream',       color: '#faf7f2' },
  { label: 'Warm white',  color: '#fdf8f0' },
  { label: 'Cool white',  color: '#f8fafc' },
  { label: 'Pure white',  color: '#ffffff' },
  { label: 'Slate dark',  color: '#0f1117' },
  { label: 'Navy dark',   color: '#0d1117' },
  { label: 'Charcoal',    color: '#1a1a2e' },
  { label: 'Espresso',    color: '#1c1208' },
];

const TEXT_PRESETS = [
  { label: 'Stone',       color: '#1c1917' },
  { label: 'Near black',  color: '#0f0f0f' },
  { label: 'Dark slate',  color: '#1e293b' },
  { label: 'Off-white',   color: '#f0f2f8' },
  { label: 'Warm white',  color: '#faf8f5' },
  { label: 'Cool white',  color: '#e8eaf0' },
];

const ACCENT_PALETTE = [
  '#22c55e','#16a34a','#15803d',
  '#3b82f6','#2563eb','#1d4ed8',
  '#a855f7','#9333ea','#7c3aed',
  '#ec4899','#db2777','#be185d',
  '#ef4444','#dc2626','#b91c1c',
  '#f97316','#ea580c','#c2410c',
  '#eab308','#ca8a04','#a16207',
  '#14b8a6','#0d9488','#0f766e',
];

function swatchRow(presets, current, area) {
  return presets.map(p => {
    const active = current === p.color;
    return `<button class="theme-swatch" data-area="${area}" data-color="${p.color}" title="${p.label}"
      style="width:28px;height:28px;border-radius:5px;background:${p.color};
             border:2px solid ${active ? 'var(--accent)' : 'var(--border)'};
             box-shadow:${active ? '0 0 0 2px var(--accent)' : 'none'}"></button>`;
  }).join('');
}

function renderThemeSection(state) {
  const theme = state.settings?.theme || {};
  const cur = { ...DEFAULT_THEME, ...theme };
  const saved = Array.isArray(theme.saved) ? theme.saved : [];

  return `<div class="section">
    <div class="section-header"><div class="section-title">Theme</div>
      <div class="text-sm text-muted">Surface, sidebar &amp; border shades are derived automatically</div>
    </div>
    <div class="card" style="display:flex;flex-direction:column;gap:1.25rem">

      <div class="form-group" style="margin:0">
        <label class="form-label">Background</label>
        <div class="flex gap-1" style="flex-wrap:wrap;margin-top:.4rem;align-items:center">
          ${swatchRow(BG_PRESETS, cur.bg, 'bg')}
          <input type="color" class="theme-custom" data-area="bg" value="${cur.bg}"
            title="Custom" style="width:28px;height:28px;border-radius:5px;border:2px solid var(--border);padding:2px;cursor:pointer" />
        </div>
      </div>

      <div class="form-group" style="margin:0">
        <label class="form-label">Text</label>
        <div class="flex gap-1" style="flex-wrap:wrap;margin-top:.4rem;align-items:center">
          ${swatchRow(TEXT_PRESETS, cur.text, 'text')}
          <input type="color" class="theme-custom" data-area="text" value="${cur.text}"
            title="Custom" style="width:28px;height:28px;border-radius:5px;border:2px solid var(--border);padding:2px;cursor:pointer" />
        </div>
      </div>

      <div class="form-group" style="margin:0">
        <label class="form-label">Accent</label>
        <div class="flex gap-1" style="flex-wrap:wrap;margin-top:.4rem;align-items:center">
          ${ACCENT_PALETTE.map(c => {
            const active = cur.accent === c;
            return `<button class="theme-swatch" data-area="accent" data-color="${c}"
              style="width:28px;height:28px;border-radius:5px;background:${c};
                     border:2px solid ${active ? 'var(--accent)' : 'var(--border)'};
                     box-shadow:${active ? '0 0 0 2px var(--accent)' : 'none'}"></button>`;
          }).join('')}
          <input type="color" class="theme-custom" data-area="accent" value="${cur.accent}"
            title="Custom" style="width:28px;height:28px;border-radius:5px;border:2px solid var(--border);padding:2px;cursor:pointer" />
        </div>
      </div>

      <div class="flex gap-2" style="flex-wrap:wrap;align-items:center">
        <button class="btn btn-primary btn-sm" id="theme-save-btn">Apply theme</button>
        <button class="btn btn-ghost btn-sm" id="theme-reset-btn">Reset to default</button>
        <button class="btn btn-ghost btn-sm" id="theme-saveas-btn">Save as preset…</button>
      </div>

      <div id="theme-saveas-form" class="hidden" style="display:none">
        <div class="flex gap-2 items-center" style="flex-wrap:wrap">
          <input class="form-input" id="theme-preset-name" placeholder="Preset name" style="max-width:200px" />
          <button class="btn btn-primary btn-sm" id="theme-preset-confirm">Save preset</button>
          <button class="btn btn-ghost btn-sm" id="theme-preset-cancel">Cancel</button>
        </div>
      </div>

      ${saved.length > 0 ? `
      <div>
        <div class="form-label" style="margin-bottom:.5rem">Saved presets</div>
        <div class="flex gap-2" style="flex-wrap:wrap">
          ${saved.map((p, i) => `
            <div class="theme-preset-card" data-index="${i}" style="
              display:flex;align-items:center;gap:.4rem;padding:.35rem .6rem;
              border:1px solid var(--border);border-radius:6px;cursor:pointer;
              background:var(--surface);user-select:none">
              <span style="display:flex;gap:3px">
                <span style="width:12px;height:12px;border-radius:50%;background:${escHtml(p.bg)};border:1px solid var(--border)"></span>
                <span style="width:12px;height:12px;border-radius:50%;background:${escHtml(p.text)};border:1px solid var(--border)"></span>
                <span style="width:12px;height:12px;border-radius:50%;background:${escHtml(p.accent)};border:1px solid var(--border)"></span>
              </span>
              <span class="text-sm">${escHtml(p.name)}</span>
              <button class="btn-icon theme-preset-delete text-muted" data-index="${i}" style="
                background:none;border:none;cursor:pointer;padding:0;line-height:1;font-size:.85rem" title="Delete preset">✕</button>
            </div>`).join('')}
        </div>
      </div>` : ''}
    </div>
  </div>`;
}

function wireTheme(state) {
  const el = document.getElementById('page-settings');
  const themeChanges = {};

  function getCurrentTheme() {
    const current = state.settings?.theme || {};
    return { ...DEFAULT_THEME, ...current, ...themeChanges };
  }

  async function persistTheme(updated) {
    const { error } = await App.supabase.from('household_settings')
      .upsert({ household_id: App.state.household.id, theme: updated }, { onConflict: 'household_id' });
    if (!error) {
      if (!state.settings) state.settings = { theme: {}, account_order: [] };
      state.settings.theme = updated;
      // Mirror to localStorage so applyTheme runs instantly on next page load
      try { localStorage.setItem('pocket_theme', JSON.stringify(updated)); } catch (_) {}
    }
    return error;
  }

  el.querySelectorAll('.theme-swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
      const { area, color } = swatch.dataset;
      themeChanges[area] = color;
      el.querySelectorAll(`.theme-swatch[data-area="${area}"]`).forEach(s => {
        const active = s.dataset.color === color;
        s.style.border = `2px solid ${active ? 'var(--accent)' : 'var(--border)'}`;
        s.style.boxShadow = active ? '0 0 0 2px var(--accent)' : 'none';
      });
    });
  });

  el.querySelectorAll('.theme-custom').forEach(inp => {
    inp.addEventListener('change', () => { themeChanges[inp.dataset.area] = inp.value; });
  });

  // Apply theme
  document.getElementById('theme-save-btn')?.addEventListener('click', async () => {
    const updated = getCurrentTheme();
    const error = await persistTheme(updated);
    if (!error) {
      const { applyTheme } = await import('./utils.js');
      applyTheme(updated);
      App.toast('Theme applied', 'success');
      render(state); // re-render so swatches reflect new saved state
    } else {
      App.toast('Error: ' + error.message, 'error');
    }
  });

  // Reset to default
  document.getElementById('theme-reset-btn')?.addEventListener('click', async () => {
    const existing = state.settings?.theme || {};
    const updated = { ...DEFAULT_THEME, saved: existing.saved || [] };
    const error = await persistTheme(updated);
    if (!error) {
      const { applyTheme } = await import('./utils.js');
      applyTheme(DEFAULT_THEME);
      App.toast('Theme reset to default', 'success');
      render(state);
    } else {
      App.toast('Error: ' + error.message, 'error');
    }
  });

  // Toggle save-as form
  document.getElementById('theme-saveas-btn')?.addEventListener('click', () => {
    const form = document.getElementById('theme-saveas-form');
    form.style.display = 'flex';
    form.classList.remove('hidden');
    document.getElementById('theme-preset-name')?.focus();
  });

  document.getElementById('theme-preset-cancel')?.addEventListener('click', () => {
    const form = document.getElementById('theme-saveas-form');
    form.style.display = 'none';
    form.classList.add('hidden');
    document.getElementById('theme-preset-name').value = '';
  });

  // Save preset
  document.getElementById('theme-preset-confirm')?.addEventListener('click', async () => {
    const name = document.getElementById('theme-preset-name')?.value.trim();
    if (!name) { App.toast('Enter a name', 'error'); return; }

    const cur = getCurrentTheme();
    const preset = { name, accent: cur.accent, bg: cur.bg, text: cur.text };
    const existing = state.settings?.theme || {};
    const saved = Array.isArray(existing.saved) ? [...existing.saved] : [];
    saved.push(preset);
    const updated = { ...cur, saved };
    const error = await persistTheme(updated);
    if (!error) {
      App.toast(`Preset "${name}" saved`, 'success');
      render(state);
    } else {
      App.toast('Error: ' + error.message, 'error');
    }
  });

  // Load preset
  el.querySelectorAll('.theme-preset-card').forEach(card => {
    card.addEventListener('click', async e => {
      if (e.target.classList.contains('theme-preset-delete')) return;
      const i = parseInt(card.dataset.index);
      const existing = state.settings?.theme || {};
      const saved = Array.isArray(existing.saved) ? existing.saved : [];
      const preset = saved[i];
      if (!preset) return;
      const updated = { ...existing, accent: preset.accent, bg: preset.bg, text: preset.text };
      const error = await persistTheme(updated);
      if (!error) {
        const { applyTheme } = await import('./utils.js');
        applyTheme(updated);
        App.toast(`"${preset.name}" loaded`, 'success');
        render(state);
      } else {
        App.toast('Error: ' + error.message, 'error');
      }
    });
  });

  // Delete preset
  el.querySelectorAll('.theme-preset-delete').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const i = parseInt(btn.dataset.index);
      const existing = state.settings?.theme || {};
      const saved = Array.isArray(existing.saved) ? [...existing.saved] : [];
      const name = saved[i]?.name || 'preset';
      saved.splice(i, 1);
      const updated = { ...existing, saved };
      const error = await persistTheme(updated);
      if (!error) {
        App.toast(`"${name}" deleted`, 'success');
        render(state);
      } else {
        App.toast('Error: ' + error.message, 'error');
      }
    });
  });
}

// ── 4. ACCOUNTS (table) ───────────────────────────────────────
function renderAccountsSection(state) {
  const { accounts, transactions } = state;
  const cur = App.currency();

  return `<div class="section">
    <div class="section-header">
      <div class="section-title">Accounts</div>
      <button class="btn btn-primary btn-sm" id="settings-add-acc-btn">+ Add account</button>
    </div>
    <div class="card" style="padding:0">
      <div class="table-wrap">
        <table class="table">
          <thead><tr>
            <th>Name</th><th>Type</th><th class="amount-col">Balance</th><th>Status</th><th style="width:120px"></th>
          </tr></thead>
          <tbody>
            ${accounts.map(a => {
              const bal = calcAccountBalance(a, transactions);
              const et = effectiveType(a);
              return `<tr class="${a.is_archived ? 'text-muted' : ''}">
                <td><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${a.color || 'var(--accent)'};margin-right:.5rem"></span>${escHtml(a.name)}</td>
                <td class="text-sm">${et}${a.type === 'custom' ? ` (${escHtml(a.custom_type || '')})` : ''}</td>
                <td class="amount-col text-mono ${bal < 0 ? 'negative' : ''}">${fmtCurrency(bal, cur)}</td>
                <td>${a.is_archived ? '<span class="badge badge-neutral">Archived</span>' : '<span class="badge badge-green">Active</span>'}</td>
                <td>
                  <div class="flex gap-1">
                    <button class="btn btn-ghost btn-sm settings-acc-edit" data-id="${a.id}">Edit</button>
                    <button class="btn btn-ghost btn-sm settings-acc-archive" data-id="${a.id}">${a.is_archived ? 'Unarchive' : 'Archive'}</button>
                    <button class="btn btn-ghost btn-sm btn-danger settings-acc-delete" data-id="${a.id}">✕</button>
                  </div>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  </div>`;
}

function wireAccountsSection(state) {
  document.getElementById('settings-add-acc-btn')?.addEventListener('click', () => {
    App.navigate('accounts');
    // Small hack: trigger add modal on accounts page after navigation
    setTimeout(() => document.getElementById('acc-add-btn')?.click(), 100);
  });

  document.querySelectorAll('.settings-acc-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      App.navigate('accounts');
      setTimeout(() => {
        const editBtn = document.querySelector(`.acc-edit-btn[data-id="${btn.dataset.id}"]`);
        editBtn?.click();
      }, 100);
    });
  });

  document.querySelectorAll('.settings-acc-archive').forEach(btn => {
    btn.addEventListener('click', async () => {
      const acc = state.accounts.find(a => a.id === btn.dataset.id);
      if (!acc) return;
      const newVal = !acc.is_archived;
      const { error } = await App.supabase.from('accounts')
        .update({ is_archived: newVal }).eq('id', acc.id).eq('household_id', App.state.household.id);
      if (!error) {
        acc.is_archived = newVal;
        App.toast(newVal ? 'Archived' : 'Unarchived', 'success');
        render(state);
      }
    });
  });

  document.querySelectorAll('.settings-acc-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ok = await App.openConfirm('Delete account', 'Transactions remain but will be unlinked.');
      if (!ok) return;
      const { error } = await App.supabase.from('accounts').delete().eq('id', btn.dataset.id).eq('household_id', App.state.household.id);
      if (!error) {
        state.accounts = state.accounts.filter(a => a.id !== btn.dataset.id);
        App.toast('Deleted', 'success');
        render(state);
      }
    });
  });
}

// ── 5. CATEGORIES ─────────────────────────────────────────────
function renderCategoriesSection(state) {
  const { categories } = state;
  const { groups, subsByParent } = buildCategoryTree(categories);

  return `<div class="section">
    <div class="section-header">
      <div class="section-title">Categories</div>
      <button class="btn btn-primary btn-sm" id="settings-add-group-btn">+ Add group</button>
    </div>
    <div class="card" style="padding:0">
      ${groups.length === 0 ? `<div class="empty-state">No categories yet</div>` :
        groups.map(g => {
          const subs = subsByParent[g.id] || [];
          return `<div style="border-bottom:1px solid var(--border)">
            <div class="flex items-center justify-between" style="padding:.65rem 1rem">
              <div class="flex items-center gap-2">
                <span style="font-size:1.1rem">${escHtml(g.icon || '')}</span>
                <div>
                  <div class="fw-500">${escHtml(g.name)}</div>
                  <div class="text-sm text-muted">${g.nature || ''} · ${subs.length} subcategories</div>
                </div>
              </div>
              <div class="flex gap-1">
                <button class="btn btn-ghost btn-sm cat-edit-btn" data-id="${g.id}">Edit</button>
                <button class="btn btn-ghost btn-sm cat-add-sub-btn" data-id="${g.id}">+ Sub</button>
                <button class="btn btn-ghost btn-sm btn-danger cat-delete-btn" data-id="${g.id}">✕</button>
              </div>
            </div>
            ${subs.map(s => `<div class="flex items-center justify-between" style="padding:.5rem 1rem .5rem 2.5rem;border-top:1px solid var(--border)40">
              <div class="flex items-center gap-2">
                <span>${escHtml(s.icon || '')}</span>
                <span class="text-sm">${escHtml(s.name)}</span>
                <span class="badge badge-neutral text-xs">${s.nature || ''}</span>
              </div>
              <div class="flex gap-1">
                <button class="btn btn-ghost btn-sm cat-edit-btn" data-id="${s.id}">Edit</button>
                <button class="btn btn-ghost btn-sm btn-danger cat-delete-btn" data-id="${s.id}">✕</button>
              </div>
            </div>`).join('')}
          </div>`;
        }).join('')
      }
    </div>
  </div>`;
}

function wireCategoriesSection(state) {
  const el = document.getElementById('page-settings');

  document.getElementById('settings-add-group-btn')?.addEventListener('click', () => openCategoryModal(state));

  el.querySelectorAll('.cat-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cat = state.categories.find(c => c.id === btn.dataset.id);
      if (cat) openCategoryModal(state, cat);
    });
  });

  el.querySelectorAll('.cat-add-sub-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const parent = state.categories.find(c => c.id === btn.dataset.id);
      openCategoryModal(state, null, parent);
    });
  });

  el.querySelectorAll('.cat-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ok = await App.openConfirm('Delete category', 'Transactions using this category will become uncategorised.');
      if (!ok) return;
      const { error } = await App.supabase.from('categories').delete().eq('id', btn.dataset.id).eq('household_id', App.state.household.id);
      if (!error) {
        state.categories = state.categories.filter(c => c.id !== btn.dataset.id);
        App.toast('Category deleted', 'success');
        render(state);
      } else {
        App.toast('Error: ' + error.message, 'error');
      }
    });
  });
}

function openCategoryModal(state, cat = null, parentGroup = null) {
  const isEdit = !!cat;
  const isSub = !!parentGroup || !!(cat?.parent_id);
  const parent = parentGroup || (cat?.parent_id ? state.categories.find(c => c.id === cat.parent_id) : null);

  const NATURES = ['Essentials', 'Variables', 'Income', 'Savings', 'Investments', 'Debt'];
  const SPEND_TYPES = ['Fixed', 'Variable', 'One-time'];
  const TX_TYPES = ['spend','income','savings','investment','transfer','withdrawal','debt_payment','adjustment'];

  const html = `<form id="cat-form">
    ${isSub ? `<div class="form-hint" style="margin-bottom:1rem">Subcategory of: <strong>${escHtml(parent?.name || '?')}</strong></div>` : ''}
    <div class="form-row">
      <div class="form-group" style="flex:0 0 70px">
        <label class="form-label">Icon</label>
        <button type="button" id="cf-icon-btn" title="${escHtml(cat?.icon || 'Pick icon')}"
          style="width:100%;height:38px;font-size:1.4rem;border:1px solid var(--border);
                 border-radius:var(--radius);background:var(--bg-input);cursor:pointer;
                 display:flex;align-items:center;justify-content:center;gap:.25rem">
          <span id="cf-icon-preview">${cat?.icon ? escHtml(cat.icon) : ''}</span>
          ${!cat?.icon ? `<span style="font-size:.7rem;color:var(--text-muted)">Pick…</span>` : ''}
        </button>
        <input type="hidden" id="cf-icon" value="${escHtml(cat?.icon || '')}" />
      </div>
      <div class="form-group" style="flex:1">
        <label class="form-label">Name *</label>
        <input class="form-input" id="cf-name" value="${escHtml(cat?.name || '')}" placeholder="Category name" />
      </div>
      <div class="form-group" style="flex:0 0 60px">
        <label class="form-label">Color</label>
        <input type="color" class="form-input" id="cf-color" value="${cat?.color || '#22c55e'}" style="height:38px;padding:2px 4px" />
      </div>
    </div>
    ${buildIconPickerHtml()}
    <div class="form-row">
      <div class="form-group" style="flex:1">
        <label class="form-label">Nature</label>
        <select class="form-select" id="cf-nature">
          <option value="">—</option>
          ${NATURES.map(n => `<option value="${n}"${cat?.nature === n ? ' selected' : ''}>${n}</option>`).join('')}
        </select>
      </div>
      <div class="form-group" style="flex:1">
        <label class="form-label">Spend type</label>
        <select class="form-select" id="cf-spend-type">
          <option value="">—</option>
          ${SPEND_TYPES.map(s => `<option value="${s}"${cat?.spend_type === s ? ' selected' : ''}>${s}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Default transaction type</label>
      <select class="form-select" id="cf-tx-type">
        <option value="">—</option>
        ${TX_TYPES.map(t => `<option value="${t}"${cat?.default_tx_type === t ? ' selected' : ''}>${t}</option>`).join('')}
      </select>
    </div>
    <div id="cf-error" class="form-error hidden"></div>
    <div class="btn-row">
      <button type="button" class="btn btn-ghost" onclick="App.closeModal()">Cancel</button>
      <button type="submit" class="btn btn-primary">${isEdit ? 'Save' : 'Create'}</button>
    </div>
  </form>`;

  App.openModal(isEdit ? 'Edit Category' : (isSub ? 'Add Subcategory' : 'Add Category Group'), html);
  wireIconPicker();

  document.getElementById('cat-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const errEl = document.getElementById('cf-error');
    errEl.classList.add('hidden');

    const name = document.getElementById('cf-name')?.value.trim();
    if (!name) { errEl.textContent = 'Name is required'; errEl.classList.remove('hidden'); return; }

    const payload = {
      household_id: App.state.household.id,
      name,
      icon: document.getElementById('cf-icon')?.value.trim() || null,
      color: document.getElementById('cf-color')?.value || null,
      nature: document.getElementById('cf-nature')?.value || null,
      spend_type: document.getElementById('cf-spend-type')?.value || null,
      default_tx_type: document.getElementById('cf-tx-type')?.value || null,
      parent_id: cat?.parent_id || parent?.id || null,
      sort_order: cat?.sort_order ?? (state.categories.filter(c => !c.parent_id).length * 10),
    };

    if (isEdit) {
      const { error } = await App.supabase.from('categories')
        .update(payload).eq('id', cat.id).eq('household_id', App.state.household.id);
      if (error) { errEl.textContent = error.message; errEl.classList.remove('hidden'); return; }
      const idx = state.categories.findIndex(c => c.id === cat.id);
      if (idx !== -1) state.categories[idx] = { ...state.categories[idx], ...payload };
      App.toast('Category updated', 'success');
    } else {
      const { data, error } = await App.supabase.from('categories').insert(payload).select().single();
      if (error) { errEl.textContent = error.message; errEl.classList.remove('hidden'); return; }
      state.categories.push(data);
      App.toast('Category created', 'success');
    }
    App.closeModal();
    render(state);
  });
}

// ── 6. RECURRING ──────────────────────────────────────────────
function renderRecurringSection(state) {
  const { recurringTemplates, categories, accounts } = state;
  const cur = App.currency();

  return `<div class="section">
    <div class="section-header">
      <div class="section-title">Recurring Templates</div>
      <button class="btn btn-primary btn-sm" id="settings-add-tmpl-btn">+ Create template</button>
    </div>
    <div class="card" style="padding:0">
      ${!recurringTemplates.length ? `<div class="empty-state">No recurring templates</div>` :
        `<div class="table-wrap">
          <table class="table">
            <thead><tr>
              <th>Description</th><th>Amount</th><th>Frequency</th><th>Status</th><th style="width:120px"></th>
            </tr></thead>
            <tbody>
              ${recurringTemplates.map(t => {
                const cat = categories.find(c => c.id === t.category_id);
                return `<tr class="${t.is_active ? '' : 'text-muted'}">
                  <td>
                    <div>${escHtml(t.description)}</div>
                    <div class="text-sm text-muted">${cat ? escHtml(cat.icon + ' ' + cat.name) : '—'}</div>
                  </td>
                  <td class="text-mono">${fmtCurrency(t.amount, cur)}</td>
                  <td class="text-sm">${t.frequency}</td>
                  <td>${t.is_active ? '<span class="badge badge-green">Active</span>' : '<span class="badge badge-neutral">Paused</span>'}</td>
                  <td>
                    <div class="flex gap-1">
                      <button class="btn btn-ghost btn-sm recur-toggle" data-id="${t.id}">${t.is_active ? 'Pause' : 'Resume'}</button>
                      <button class="btn btn-ghost btn-sm btn-danger recur-delete" data-id="${t.id}">✕</button>
                    </div>
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>`
      }
    </div>
  </div>`;
}

function wireRecurringSection(state) {
  document.getElementById('settings-add-tmpl-btn')?.addEventListener('click', () => {
    App.navigate('recurring');
    setTimeout(() => document.getElementById('recur-add-btn')?.click(), 100);
  });

  document.querySelectorAll('.recur-toggle').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tmpl = state.recurringTemplates.find(t => t.id === btn.dataset.id);
      if (!tmpl) return;
      const newVal = !tmpl.is_active;
      const { error } = await App.supabase.from('recurring_templates')
        .update({ is_active: newVal }).eq('id', tmpl.id).eq('household_id', App.state.household.id);
      if (!error) {
        tmpl.is_active = newVal;
        App.toast(newVal ? 'Resumed' : 'Paused', 'success');
        render(state);
      }
    });
  });

  document.querySelectorAll('.recur-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ok = await App.openConfirm('Delete template', 'Future auto-logging will stop. Existing transactions are kept.');
      if (!ok) return;
      const { error } = await App.supabase.from('recurring_templates').delete().eq('id', btn.dataset.id).eq('household_id', App.state.household.id);
      if (!error) {
        state.recurringTemplates = state.recurringTemplates.filter(t => t.id !== btn.dataset.id);
        App.toast('Template deleted', 'success');
        render(state);
      }
    });
  });
}

// ── 7. ACCOUNT (personal) ─────────────────────────────────────
function renderAccountSection(state) {
  const profile = state.profile;
  return `<div class="section">
    <div class="section-header"><div class="section-title">My Account</div></div>
    <div class="card">
      <div class="form-group">
        <label class="form-label">Display name</label>
        <div class="flex gap-2">
          <input class="form-input" id="my-name" value="${escHtml(profile?.display_name || '')}" style="max-width:260px" />
          <button class="btn btn-primary btn-sm" id="my-name-save">Save</button>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Email</label>
        <span class="text-muted">${escHtml(App.state.user?.email || '—')}</span>
      </div>
      <div class="divider" style="margin:1rem 0"></div>
      <button class="btn btn-danger btn-sm" id="settings-signout">Sign out</button>
    </div>
  </div>`;
}

// Wire account section (called after render)
document.addEventListener('click', async e => {
  if (e.target.id === 'my-name-save') {
    const name = document.getElementById('my-name')?.value.trim();
    if (!name) return;
    const { error } = await App.supabase.from('profiles')
      .update({ display_name: name }).eq('id', App.state.user.id);
    if (!error) {
      if (App.state.profile) App.state.profile.display_name = name;
      App.renderUserPill();
      App.toast('Name updated', 'success');
    }
  }
  if (e.target.id === 'settings-signout') {
    App.signOut();
  }
});
