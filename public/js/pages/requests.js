import { api } from '../api.js';
import { initPage } from '../layout.js';
import { onLive } from '../live.js';
import { esc, fmtRelative, statusBadge, priorityBadge, overdueBadge, toast } from '../ui.js';

const user = await initPage();
const isStaff = user.role !== 'candidate';
const form = document.getElementById('filters');

if (isStaff) document.querySelectorAll('[data-staff]').forEach((el) => { el.hidden = false; });
else {
  document.getElementById('page-title').textContent = 'My requests';
  document.getElementById('new-btn').classList.remove('hidden');
}

const [{ categories }, { statuses }] = await Promise.all([api('/requests/categories'), api('/workflow/rules')]);
form.status.insertAdjacentHTML('beforeend', statuses.map((s) => `<option>${esc(s)}</option>`).join(''));
form.categoryId.insertAdjacentHTML('beforeend', categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join(''));
if (isStaff) {
  const { staff } = await api('/requests/staff');
  form.assigned.insertAdjacentHTML('beforeend', staff.filter((s) => s.id !== user.id).map((s) => `<option value="${s.id}">${esc(s.full_name)}</option>`).join(''));
}

// Restore filters from URL (shareable / back-button friendly)
const params = new URLSearchParams(location.search);
for (const [k, v] of params) {
  if (k === 'overdue') form.overdue.checked = v === 'true';
  else if (k === 'sort' && params.get('order')) form.sort.value = `${v}:${params.get('order')}`;
  else if (form.elements[k] && k !== 'order') form.elements[k].value = v;
}
let page = Number(params.get('page')) || 1;

function currentQuery() {
  const [sort, order] = form.sort.value.split(':');
  return {
    q: form.q.value.trim(), status: form.status.value, categoryId: form.categoryId.value, priority: form.priority.value,
    assigned: isStaff ? form.assigned.value : '', overdue: isStaff && form.overdue.checked ? 'true' : '',
    sort, order, page, pageSize: 15,
  };
}

async function load() {
  const query = currentQuery();
  const url = new URLSearchParams(Object.entries(query).filter(([k, v]) => v && !(k === 'page' && v === 1) && k !== 'pageSize'));
  history.replaceState(null, '', `${location.pathname}${[...url].length ? `?${url}` : ''}`);
  const cols = isStaff ? 8 : 6;
  document.getElementById('rows').innerHTML = `<tr><td colspan="${cols}"><div class="skeleton h-5 w-full"></div></td></tr>`;
  try {
    const data = await api('/requests', { query });
    render(data);
  } catch (err) {
    toast(err.message, 'error');
  }
}

function render({ items, total, page: p, pages }) {
  document.getElementById('result-count').textContent = `${total} request${total === 1 ? '' : 's'} found`;
  const rows = document.getElementById('rows');
  rows.innerHTML = items.length ? items.map((r) => `
    <tr class="cursor-pointer" data-href="/request?id=${r.id}">
      <td class="whitespace-nowrap font-semibold"><a href="/request?id=${r.id}" class="text-salmon-50 hover:underline">${esc(r.reference)}</a></td>
      <td class="min-w-[14rem]"><span class="font-medium">${esc(r.title)}</span>${r.is_overdue ? `<span class="ml-2">${overdueBadge()}</span>` : ''}</td>
      ${isStaff ? `<td class="whitespace-nowrap">${esc(r.candidate_name)}</td>` : ''}
      <td class="whitespace-nowrap text-white/60">${esc(r.category)}</td>
      <td>${priorityBadge(r.priority)}</td>
      <td>${statusBadge(r.status)}</td>
      ${isStaff ? `<td class="whitespace-nowrap">${r.assignee_name ? esc(r.assignee_name) : '<span class="text-white/40">Unassigned</span>'}</td>` : ''}
      <td class="whitespace-nowrap text-white/60"><time datetime="${r.updated_at}">${fmtRelative(r.updated_at)}</time></td>
    </tr>`).join('')
    : `<tr><td colspan="${isStaff ? 8 : 6}" class="py-10 text-center text-white/60">No requests match these filters.</td></tr>`;

  rows.querySelectorAll('tr[data-href]').forEach((tr) => tr.addEventListener('click', (e) => {
    if (!e.target.closest('a')) location.href = tr.dataset.href;
  }));

  document.getElementById('pager').innerHTML = pages > 1 ? `
    <button type="button" class="btn btn-ghost btn-sm" data-page="${p - 1}" ${p <= 1 ? 'disabled' : ''}>← Previous</button>
    <span class="text-sm text-white/60">Page ${p} of ${pages}</span>
    <button type="button" class="btn btn-ghost btn-sm" data-page="${p + 1}" ${p >= pages ? 'disabled' : ''}>Next →</button>` : '';
}

document.getElementById('pager').addEventListener('click', (e) => {
  const b = e.target.closest('[data-page]');
  if (b && !b.disabled) { page = Number(b.dataset.page); load(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
});

let debounce;
form.addEventListener('input', (e) => {
  clearTimeout(debounce);
  page = 1;
  debounce = setTimeout(load, e.target.name === 'q' ? 300 : 0);
});
form.addEventListener('reset', () => setTimeout(() => { page = 1; load(); }));
form.addEventListener('submit', (e) => e.preventDefault());

load();
onLive('request', load, 500);
