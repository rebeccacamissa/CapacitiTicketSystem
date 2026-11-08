// Command palette (Ctrl/Cmd + K): pages, quick actions, request & candidate search.
import { api } from '../api.js';
import { esc, statusBadge } from '../ui.js';
import { icon } from '../icons.js';

let open = false;
let ctx = null;

export function initPalette({ user, pages, actions }) {
  ctx = { user, pages, actions };
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); toggle(); }
  });
}

export function toggle() { if (open) close(); else show(); }

let dlg;
function close() { if (dlg) { dlg.dataset.open = 'false'; setTimeout(() => { dlg?.close(); dlg?.remove(); dlg = null; }, 200); } open = false; }

function show() {
  open = true;
  dlg = document.createElement('dialog');
  dlg.className = 'modal glass-strong mx-auto mt-[12vh] mb-auto w-[calc(100%-2rem)] max-w-xl overflow-hidden p-0 text-white';
  dlg.setAttribute('aria-label', 'Command palette');
  dlg.innerHTML = `
    <div class="flex items-center gap-3 border-b border-white/10 px-4">
      ${icon('search', 'h-5 w-5 text-white/50')}
      <input data-q class="w-full bg-transparent py-4 text-base text-white placeholder:text-white/40 focus:outline-none" placeholder="Search requests${ctx.user.role !== 'candidate' ? ', candidates' : ''}, pages and actions…" role="combobox" aria-expanded="true" aria-controls="pal-list" aria-autocomplete="list">
      <kbd class="rounded-md border border-white/15 px-1.5 py-0.5 text-[0.65rem] text-white/50">Esc</kbd>
    </div>
    <ul id="pal-list" data-list class="max-h-[50vh] overflow-y-auto p-2" role="listbox"></ul>
    <div class="flex items-center gap-4 border-t border-white/10 px-4 py-2 text-[0.7rem] text-white/45">
      <span><kbd class="rounded border border-white/15 px-1">↑</kbd> <kbd class="rounded border border-white/15 px-1">↓</kbd> navigate</span>
      <span><kbd class="rounded border border-white/15 px-1">Enter</kbd> open</span>
    </div>`;
  document.body.append(dlg);
  dlg.showModal();
  requestAnimationFrame(() => { dlg.dataset.open = 'true'; });
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });

  const input = dlg.querySelector('[data-q]');
  const list = dlg.querySelector('[data-list]');
  let items = [];
  let active = 0;
  let seq = 0;

  const render = () => {
    let group = '';
    list.innerHTML = items.length ? items.map((it, i) => {
      const head = it.group !== group ? `<li class="px-3 pt-3 pb-1 text-[0.65rem] font-semibold tracking-wider text-white/40 uppercase" role="presentation">${it.group}</li>` : '';
      group = it.group;
      return `${head}<li role="option" id="pal-${i}" aria-selected="${i === active}" data-i="${i}"
        class="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition aria-selected:bg-gradient-to-r aria-selected:from-purple/40 aria-selected:to-salmon/20">
        <span class="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.07] text-white/80">${icon(it.icon, 'h-4 w-4')}</span>
        <span class="min-w-0 flex-1"><span class="block truncate font-medium">${esc(it.label)}</span>${it.hint ? `<span class="block truncate text-xs text-white/50">${it.hint}</span>` : ''}</span>
        ${it.badge || ''}</li>`;
    }).join('') : '<li class="px-3 py-8 text-center text-sm text-white/50">No matches</li>';
    input.setAttribute('aria-activedescendant', `pal-${active}`);
    list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  };

  const base = (q) => {
    const m = (t) => !q || t.toLowerCase().includes(q.toLowerCase());
    return [
      ...ctx.actions.filter((a) => m(a.label)).map((a) => ({ ...a, group: 'Actions' })),
      ...ctx.pages.filter((p) => m(p.label)).map((p) => ({ ...p, group: 'Go to' })),
    ];
  };

  const update = async () => {
    const q = input.value.trim();
    const mySeq = ++seq;
    items = base(q);
    active = 0;
    render();
    if (q.length < 2) return;
    try {
      const r = await api('/search', { query: { q } });
      if (mySeq !== seq) return;
      items = [
        ...r.requests.map((x) => ({ group: 'Requests', icon: 'ticket', label: x.title, hint: esc(x.reference), badge: statusBadge(x.status), href: `/request?id=${x.id}` })),
        ...r.candidates.map((x) => ({ group: 'Candidates', icon: 'user', label: x.full_name, hint: esc(x.stream || x.email), href: `/candidates?id=${x.id}` })),
        ...items,
      ];
      render();
    } catch { /* ignore */ }
  };

  const run = (it) => {
    if (!it) return;
    close();
    if (it.run) it.run();
    else if (it.href) location.href = it.href;
  };

  input.addEventListener('input', update);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(items.length - 1, active + 1); render(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); render(); }
    if (e.key === 'Enter') { e.preventDefault(); run(items[active]); }
  });
  list.addEventListener('click', (e) => { const li = e.target.closest('[data-i]'); if (li) run(items[Number(li.dataset.i)]); });
  list.addEventListener('mousemove', (e) => { const li = e.target.closest('[data-i]'); if (li && Number(li.dataset.i) !== active) { active = Number(li.dataset.i); render(); } });
  update();
  input.focus();
}
