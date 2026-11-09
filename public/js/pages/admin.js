import { api } from '../api.js';
import { initPage, ROLE_LABEL } from '../layout.js';
import { icon } from '../icons.js';
import { onLive } from '../live.js';
import { esc, toast, setBusy, avatarHtml, countUp, openModal, showFieldErrors } from '../ui.js';

const me = await initPage({ roles: ['admin'] });
const options = await api('/meta/options');
let users = [];
let roleFilter = 'all';

const ROLE_STYLE = { candidate: 'bg-purple/25 text-purple-30', support: 'bg-salmon/20 text-salmon-50', admin: 'bg-white/15 text-white', recruiter: 'bg-ok/15 text-ok' };

// ---- KPIs ---------------------------------------------------------------------
async function loadKpis() {
  const d = await api('/analytics/summary');
  const by = Object.fromEntries(d.users.map((u) => [u.role, u]));
  const k = [
    ['Candidates', by.candidate?.active || 0, 'users'],
    ['Support staff', (by.support?.active || 0) + (by.admin?.active || 0), 'shield'],
    ['Open requests', d.totals.open + d.totals.in_progress, 'ticket'],
    ['Overdue', d.totals.overdue, 'alert'],
  ];
  document.getElementById('kpis').innerHTML = k.map(([label, v, ic]) => `
    <div class="rounded-2xl border border-white/10 bg-ink/40 p-4 backdrop-blur"><p class="flex items-center gap-2 text-xs text-white/60">${icon(ic, 'h-4 w-4')}${label}</p>
    <p class="mt-1 font-display text-3xl font-semibold tabular-nums" data-count="${v}">0</p></div>`).join('');
  countUp(document.getElementById('kpis'));
}

// ---- Users ------------------------------------------------------------------
const filterEl = document.getElementById('role-filter');
filterEl.innerHTML = [['all', 'All'], ['candidate', 'Candidates'], ['support', 'Support'], ['admin', 'Admins'], ['recruiter', 'Recruiters']].map(([v, l]) =>
  `<button type="button" data-filter="${v}" aria-pressed="${v === roleFilter}" class="rounded-lg px-3 py-1.5 text-xs font-semibold text-white/60 transition hover:text-white aria-pressed:bg-white/15 aria-pressed:text-white">${l}</button>`).join('');
filterEl.addEventListener('click', (e) => {
  const b = e.target.closest('[data-filter]');
  if (!b) return;
  roleFilter = b.dataset.filter;
  filterEl.querySelectorAll('[data-filter]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  renderUsers();
});
document.getElementById('user-search').addEventListener('input', renderUsers);

async function loadUsers() {
  ({ users } = await api('/admin/users'));
  renderUsers();
}

function renderUsers() {
  const term = document.getElementById('user-search').value.trim().toLowerCase();
  const rows = users.filter((u) => (roleFilter === 'all' || u.role === roleFilter) && (!term || `${u.full_name} ${u.email} ${u.employee_id || ''}`.toLowerCase().includes(term)));
  document.getElementById('users').innerHTML = rows.map((u) => `
    <tr class="${u.is_active ? '' : 'opacity-55'}">
      <td><div class="flex items-center gap-3">${avatarHtml({ name: u.full_name, avatar: u.avatar, id: u.id }, 'h-10 w-10 text-xs')}
        <div class="min-w-0"><p class="truncate font-medium">${esc(u.full_name)}${u.id === me.id ? ' <span class="text-xs text-white/40">(you)</span>' : ''}</p><p class="truncate text-xs text-white/50">${esc(u.email)}</p></div></div></td>
      <td><label class="sr-only" for="role-${u.id}">Role for ${esc(u.full_name)}</label>
        <select id="role-${u.id}" data-role="${u.id}" class="field !w-44 !py-1.5 !text-xs" ${u.id === me.id ? 'disabled' : ''}>
          ${['candidate', 'support', 'admin', 'recruiter'].map((r) => `<option value="${r}" ${r === u.role ? 'selected' : ''}>${ROLE_LABEL[r]}</option>`).join('')}
        </select></td>
      <td class="text-xs text-white/65">${u.role === 'candidate'
        ? `${esc(u.stream || '—')}<span class="block text-white/40">${esc(u.cohort || '')} · ${u.requests_raised} request(s)</span>`
        : `${esc(u.position || '—')}<span class="block text-white/40">${esc(u.employee_id || 'No employee ID')} · ${u.active_assigned} active case(s)</span>`}</td>
      <td><div class="flex flex-col items-start gap-1">${u.is_active ? '<span class="badge bg-ok/15 text-ok"><span class="h-1.5 w-1.5 rounded-full bg-ok"></span>Active</span>' : '<span class="badge bg-white/10 text-white/50">Deactivated</span>'}
        ${u.must_change_password ? `<span class="badge bg-warn/15 text-warn">${icon('key', 'h-3 w-3')}Temp password</span>` : ''}</div></td>
      <td class="text-right">${u.id === me.id ? '' : `<div class="flex justify-end gap-1.5">
        <button class="btn btn-ghost btn-sm" data-reset="${u.id}" title="Generate a new temporary password">Reset password</button>
        <button class="btn btn-ghost btn-sm" data-active="${u.id}" data-value="${!u.is_active}">${u.is_active ? 'Deactivate' : 'Activate'}</button>
        <button class="btn btn-sm border border-salmon/40 bg-salmon/10 text-salmon-50 hover:bg-salmon/25" data-remove="${u.id}">Remove</button></div>`}</td>
    </tr>`).join('') || '<tr><td colspan="5" class="py-8 text-center text-white/50">No users match.</td></tr>';
}

function showTempPassword(name, email, pw, heading) {
  const m = openModal(`
    <div class="p-6 text-center">
      <div class="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-purple to-salmon text-snow animate-pop">${icon('key', 'h-7 w-7')}</div>
      <h2 class="mt-4 text-xl">${heading}</h2>
      <p class="mt-1 text-sm text-white/60">Share this temporary password with <strong class="text-white">${esc(name)}</strong> (${esc(email)}) securely. It is shown <strong class="text-white">only once</strong> — they'll be asked to set their own at first sign-in.</p>
      <div class="mt-5 flex items-center gap-2 rounded-2xl border border-white/15 bg-ink/60 p-2 pl-4">
        <code class="flex-1 text-left font-mono text-lg tracking-wider text-salmon-50" data-pw>${esc(pw)}</code>
        <button type="button" class="btn btn-primary btn-sm" data-copy>Copy</button>
      </div>
      <button type="button" class="btn btn-ghost mt-5 w-full" data-close>Done</button>
    </div>`);
  m.el.querySelector('[data-copy]').addEventListener('click', async (e) => {
    try { await navigator.clipboard.writeText(pw); e.target.textContent = 'Copied'; } catch { toast('Copy failed — select the text manually', 'error'); }
  });
}

const table = document.getElementById('users');
table.addEventListener('change', async (e) => {
  const sel = e.target.closest('[data-role]');
  if (!sel) return;
  try { await api(`/admin/users/${sel.dataset.role}`, { method: 'PATCH', body: { role: sel.value } }); toast('Role updated', 'success'); }
  catch (err) { toast(err.message, 'error'); }
  loadUsers();
});
table.addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const id = Number(b.dataset.reset || b.dataset.active || b.dataset.remove);
  const u = users.find((x) => x.id === id);
  if (!u) return;
  try {
    if (b.dataset.reset) {
      const { tempPassword } = await api(`/admin/users/${id}/reset-password`, { method: 'POST' });
      showTempPassword(u.full_name, u.email, tempPassword, 'Password reset');
      loadUsers();
    } else if (b.dataset.active) {
      await api(`/admin/users/${id}`, { method: 'PATCH', body: { isActive: b.dataset.value === 'true' } });
      toast(b.dataset.value === 'true' ? 'User activated' : 'User deactivated', 'success');
      loadUsers();
    } else if (b.dataset.remove) {
      const m = openModal(`<div class="p-6"><h2 class="text-xl">Remove ${esc(u.full_name)}?</h2>
        <p class="mt-2 text-sm text-white/60">This permanently deletes the account. Users with support history can't be removed (the audit trail must be kept) — deactivate them instead.</p>
        <div class="mt-6 flex justify-end gap-2"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-accent" data-confirm>Remove user</button></div></div>`);
      m.el.querySelector('[data-confirm]').addEventListener('click', async () => {
        try {
          await api(`/admin/users/${id}`, { method: 'DELETE' });
          toast('User removed', 'success');
          m.close();
          const row = b.closest('tr');
          row.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateX(30px)' }], { duration: 300, fill: 'forwards' });
          setTimeout(() => { loadUsers(); loadKpis(); }, 300);
        } catch (err) { m.close(); toast(err.message, 'error'); }
      });
    }
  } catch (err) { toast(err.message, 'error'); }
});

// ---- Add user (temporary password generated by the server) -----------------------
document.getElementById('add-user').addEventListener('click', () => {
  const m = openModal(`
    <form class="p-6" novalidate>
      <h2 class="text-xl">Add a user</h2>
      <p class="mt-1 text-sm text-white/60">A secure temporary password is generated automatically.</p>
      <div class="mt-5 grid grid-cols-3 gap-1 rounded-xl border border-white/10 bg-white/5 p-1" role="radiogroup" aria-label="Role">
        ${['support', 'admin', 'candidate'].map((r, i) => `<label class="cursor-pointer rounded-lg px-2 py-2 text-center text-xs font-semibold text-white/60 transition has-[:checked]:bg-gradient-to-r has-[:checked]:from-purple has-[:checked]:to-salmon has-[:checked]:text-white">
          <input type="radio" name="role" value="${r}" class="sr-only" ${i === 0 ? 'checked' : ''}>${ROLE_LABEL[r]}</label>`).join('')}
      </div>
      <div class="mt-5 grid gap-4 sm:grid-cols-2">
        <div><label class="field-label" for="nu-first">First name</label><input id="nu-first" name="firstName" class="field" required><p class="field-error" data-error-for="firstName"></p></div>
        <div><label class="field-label" for="nu-sur">Surname</label><input id="nu-sur" name="surname" class="field" required><p class="field-error" data-error-for="surname"></p></div>
        <div><label class="field-label" for="nu-email">Email</label><input id="nu-email" name="email" type="email" class="field" required><p class="field-error" data-error-for="email"></p></div>
        <div><label class="field-label" for="nu-dob">Date of birth</label><input id="nu-dob" name="dateOfBirth" type="date" class="field"><p class="field-error" data-error-for="dateOfBirth"></p></div>
        <div class="sm:col-span-2"><label class="field-label" for="nu-gender">Gender <span class="font-normal text-white/50">(sets their starting avatar)</span></label>
          <select id="nu-gender" name="gender" class="field"><option value="prefer-not">Prefer not to say</option><option value="female">Female</option><option value="male">Male</option><option value="non-binary">Non-binary</option></select></div>
        <div data-for="staff"><label class="field-label" for="nu-pos">Position</label><input id="nu-pos" name="position" list="positions" class="field"><datalist id="positions">${options.positions.map((p) => `<option value="${esc(p)}">`).join('')}</datalist></div>
        <div data-for="staff"><label class="field-label" for="nu-emp">Employee ID</label><input id="nu-emp" name="employeeId" class="field" placeholder="CAP-0000"><p class="field-error" data-error-for="employeeId"></p></div>
        <div data-for="candidate" hidden><label class="field-label" for="nu-cohort">Cohort</label><input id="nu-cohort" name="cohort" list="cohorts" class="field"><datalist id="cohorts">${options.cohorts.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></div>
        <div data-for="candidate" hidden><label class="field-label" for="nu-stream">Stream</label><select id="nu-stream" name="stream" class="field"><option value="">—</option>${options.streams.map((s) => `<option>${esc(s)}</option>`).join('')}</select></div>
        <div data-for="candidate" hidden><label class="field-label" for="nu-mentor">Mentor</label><input id="nu-mentor" name="mentor" class="field"></div>
        <div data-for="candidate" hidden><label class="field-label" for="nu-tc">Tech Champ</label><input id="nu-tc" name="techChamp" class="field"></div>
        <div data-for="candidate" hidden class="sm:col-span-2"><label class="field-label" for="nu-sup">Supervisor</label><input id="nu-sup" name="supervisor" class="field"></div>
      </div>
      <div class="mt-6 flex justify-end gap-2"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary btn-shine">Create user</button></div>
    </form>`, { wide: true });

  const form = m.el.querySelector('form');
  const sync = () => {
    const staff = form.role.value !== 'candidate';
    form.querySelectorAll('[data-for="staff"]').forEach((el) => { el.hidden = !staff; });
    form.querySelectorAll('[data-for="candidate"]').forEach((el) => { el.hidden = staff; });
  };
  form.addEventListener('change', sync);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const role = form.role.value;
    const keep = role === 'candidate' ? ['cohort', 'stream', 'mentor', 'techChamp', 'supervisor'] : ['position', 'employeeId'];
    const body = { role };
    for (const k of ['firstName', 'surname', 'email', 'dateOfBirth', 'gender', ...keep]) body[k] = form[k].value.trim() || undefined;
    const errs = {};
    if (!body.firstName) errs.firstName = 'Required';
    if (!body.surname) errs.surname = 'Required';
    if (!body.email) errs.email = 'Required';
    if (role !== 'candidate' && !body.employeeId) errs.employeeId = 'Required for staff';
    if (!showFieldErrors(form, errs)) return;
    const btn = form.querySelector('button.btn-primary');
    setBusy(btn, true, 'Creating…');
    try {
      const { tempPassword } = await api('/admin/users', { method: 'POST', body });
      m.close();
      showTempPassword(`${body.firstName} ${body.surname}`, body.email, tempPassword, 'User created');
      loadUsers(); loadKpis();
    } catch (err) {
      setBusy(btn, false);
      showFieldErrors(form, err.details?.fields || (err.code === 'EMAIL_TAKEN' ? { email: err.message } : err.code === 'EMPLOYEE_ID_TAKEN' ? { employeeId: err.message } : {}));
      toast(err.message, 'error');
    }
  });
});

// ---- Categories -------------------------------------------------------------
async function loadCats() {
  const { categories } = await api('/admin/categories');
  document.getElementById('cats').innerHTML = categories.map((c) => `
    <tr><td><span class="font-medium">${esc(c.name)}</span><span class="block text-xs text-white/45">${esc(c.description || '')}</span></td>
      <td class="tabular-nums">${c.request_count}</td>
      <td><input type="checkbox" class="h-4 w-4 accent-salmon" data-cat="${c.id}" data-field="isBlocker" ${c.is_blocker ? 'checked' : ''} aria-label="Blocker: ${esc(c.name)}"></td>
      <td><input type="checkbox" class="h-4 w-4 accent-purple" data-cat="${c.id}" data-field="isActive" ${c.is_active ? 'checked' : ''} aria-label="Active: ${esc(c.name)}"></td></tr>`).join('');
}
document.getElementById('cats').addEventListener('change', async (e) => {
  const box = e.target.closest('[data-cat]');
  if (!box) return;
  try { await api(`/admin/categories/${box.dataset.cat}`, { method: 'PATCH', body: { [box.dataset.field]: box.checked } }); toast('Category updated', 'success'); }
  catch (err) { toast(err.message, 'error'); box.checked = !box.checked; }
});
const catForm = document.getElementById('new-cat-form');
catForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/admin/categories', { method: 'POST', body: { name: catForm.name.value.trim(), description: catForm.description.value.trim() || undefined, isBlocker: catForm.isBlocker.checked } });
    toast('Category added', 'success'); catForm.reset(); loadCats();
onLive('people', loadUsers);
onLive('request', loadKpis, 800);
  } catch (err) { toast(err.message, 'error'); }
});

// ---- DB probe --------------------------------------------------------------
const probe = document.getElementById('probe-form');
const [{ items }, { statuses }] = await Promise.all([api('/requests', { query: { pageSize: 100 } }), api('/workflow/rules')]);
probe.requestId.innerHTML = items.map((r) => `<option value="${r.id}">${esc(r.reference)} — ${esc(r.status)}</option>`).join('');
probe.toStatus.innerHTML = statuses.map((s) => `<option>${esc(s)}</option>`).join('');
probe.toStatus.value = 'Closed';
probe.addEventListener('submit', async (e) => {
  e.preventDefault();
  const out = document.getElementById('probe-out');
  out.classList.remove('hidden');
  const body = { requestId: Number(probe.requestId.value), toStatus: probe.toStatus.value, withAudit: probe.withAudit.checked };
  try {
    const res = await api('/workflow/db-probe', { method: 'POST', body });
    out.innerHTML = `<span class="text-ok">HTTP 200 — ACCEPTED by database</span>\n\n${esc(JSON.stringify(res, null, 2))}`;
  } catch (err) {
    out.innerHTML = `<span class="text-salmon-50">HTTP ${err.status} — BLOCKED by database</span>\n\n${esc(JSON.stringify({ error: { code: err.code, message: err.message, details: err.details } }, null, 2))}`;
  }
  out.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 300 });
});

loadKpis();
loadUsers();
loadCats();
onLive('people', loadUsers);
onLive('request', loadKpis, 800);
