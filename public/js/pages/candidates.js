import { api } from '../api.js';
import { initPage } from '../layout.js';
import { esc, toast, avatarHtml, setBusy, showFieldErrors, fmtDate } from '../ui.js';
import { createRoadmap } from '../components/roadmap.js';
import { icon } from '../icons.js';
import { onLive } from '../live.js';
import { needLabel } from '../needs.js';

const me = await initPage({ roles: ['support', 'admin', 'facilitator'] });
const canEdit = me.role !== 'facilitator'; // facilitators verify evidence but don't edit profile details

const [{ candidates }, options] = await Promise.all([api('/candidates'), api('/meta/options')]);
const list = document.getElementById('cand-list');
const search = document.getElementById('cand-search');
const detail = document.getElementById('detail');
let selected = Number(new URLSearchParams(location.search).get('id')) || null;

function renderList() {
  const term = search.value.trim().toLowerCase();
  list.innerHTML = candidates
    .filter((c) => !term || [c.full_name, c.email, c.cohort, c.stream].some((v) => (v || '').toLowerCase().includes(term)))
    .map((c) => `<li><button type="button" role="option" aria-selected="${c.id === selected}" data-id="${c.id}"
        class="flex w-full items-center gap-3 rounded-2xl px-2.5 py-2 text-left transition hover:bg-white/[0.06] aria-selected:bg-gradient-to-r aria-selected:from-purple/40 aria-selected:to-salmon/20">
        ${avatarHtml({ name: c.full_name, avatar: c.avatar, id: c.id }, 'h-10 w-10 text-xs')}
        <span class="min-w-0 flex-1"><span class="block truncate text-sm font-medium">${esc(c.full_name)}</span><span class="block truncate text-xs text-white/50">${esc(c.stream || c.email)}</span></span>
        ${c.accessibility?.needs?.length ? `<span class="text-purple-30" title="Has accessibility needs">${icon('accessibility', 'h-4 w-4')}</span>` : ''}${c.open_requests ? `<span class="badge bg-salmon/20 text-salmon-50" title="Open requests">${c.open_requests}</span>` : ''}
      </button></li>`).join('') || '<li class="p-3 text-sm text-white/50">No matches.</li>';
}

async function select(id) {
  selected = id;
  history.replaceState(null, '', `?id=${id}`);
  renderList();
  const { profile: p } = await api(`/candidates/${id}`);
  const c = p.candidate || {};
  const field = (name, label, value, extra = '') => `<div><label for="f-${name}" class="field-label">${label}</label><input id="f-${name}" name="${name}" value="${esc(value || '')}" class="field" ${extra}><p class="field-error" data-error-for="${name}"></p></div>`;

  detail.innerHTML = `
    <section class="glass relative overflow-hidden p-6 animate-fade-up">
      <div class="absolute inset-0 bg-gradient-to-r from-purple/30 to-salmon/20"></div>
      <div class="relative flex flex-wrap items-center gap-5">
        ${avatarHtml({ name: p.fullName, avatar: p.avatar, id: p.id }, 'h-20 w-20 text-2xl', 'ring-4 !ring-white/20')}
        <div class="min-w-0 flex-1">
          <h2 class="text-2xl">${esc(p.fullName)}</h2>
          <p class="text-sm text-white/65">${esc(p.email)} · joined ${fmtDate(p.createdAt)}</p>
          <div class="mt-2 flex flex-wrap gap-2">
            ${c.cohort ? `<span class="chip">${esc(c.cohort)}</span>` : ''}${c.stream ? `<span class="chip">${esc(c.stream)}</span>` : ''}
            ${p.birthday ? `<span class="chip">${icon('cake', 'h-3.5 w-3.5')}${p.birthday.isToday ? 'Birthday today!' : `Birthday in ${p.birthday.daysUntil} days`}</span>` : ''}
          </div>
        </div>
        ${canEdit ? `<a href="/requests?q=${encodeURIComponent(p.fullName)}" class="btn btn-ghost">View requests</a>` : ''}
        ${['admin', 'facilitator'].includes(me.role) ? `<a href="/stage-decisions?candidate=${p.id}" class="btn btn-primary">Review stage</a>` : ''}
      </div>
      ${p.accessibility?.needs?.length ? `<div class="relative mt-4 rounded-xl border border-white/15 bg-ink/40 p-3 text-sm"><p class="flex items-center gap-1.5 font-semibold">${icon('accessibility', 'h-4 w-4')}Accessibility needs</p>
        <p class="mt-1 text-white/75">${p.accessibility.needs.map((n) => esc(needLabel(n))).join(' · ')}</p>${p.accessibility.notes ? `<p class="mt-1 text-xs text-white/60" translate="no">${esc(p.accessibility.notes)}</p>` : ''}</div>` : ''}
    </section>

    <form id="cand-form" class="card space-y-5 animate-fade-up [animation-delay:80ms]" novalidate ${canEdit ? '' : 'hidden'}>
      <div class="flex items-center justify-between gap-3"><h3 class="text-lg">Candidate information</h3>
        <p class="text-xs text-white/45">${c.updatedAt ? `Last updated ${fmtDate(c.updatedAt)}` : ''}</p></div>
      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        ${field('firstName', 'First name', p.firstName)}${field('surname', 'Surname', p.surname)}
        <div><label for="f-dob" class="field-label">Date of birth</label><input id="f-dob" name="dateOfBirth" type="date" value="${esc(p.dateOfBirth || '')}" class="field"><p class="field-error" data-error-for="dateOfBirth"></p></div>
        <div><label for="f-cohort" class="field-label">Cohort</label><input id="f-cohort" name="cohort" list="cohorts" value="${esc(c.cohort || '')}" class="field"><datalist id="cohorts">${options.cohorts.map((o) => `<option value="${esc(o)}">`).join('')}</datalist></div>
        <div><label for="f-stream" class="field-label">Stream</label><select id="f-stream" name="stream" class="field"><option value="">—</option>${options.streams.map((s) => `<option ${s === c.stream ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
        ${field('mentor', 'Mentor', c.mentor)}${field('techChamp', 'Tech Champ', c.techChamp)}${field('supervisor', 'Supervisor', c.supervisor)}
      </div>
      <div class="flex justify-end"><button class="btn btn-primary btn-shine">Save changes</button></div>
    </form>

    <div id="roadmap-wrap" class="animate-fade-up [animation-delay:160ms]"></div>`;

  const form = document.getElementById('cand-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button');
    setBusy(btn, true, 'Saving…');
    const body = Object.fromEntries([...new FormData(form)].map(([k, v]) => [k, String(v).trim() || undefined]));
    try {
      await api(`/candidates/${id}`, { method: 'PATCH', body });
      toast('Candidate updated', 'success');
      const idx = candidates.findIndex((x) => x.id === id);
      Object.assign(candidates[idx], { full_name: `${body.firstName || p.firstName} ${body.surname || p.surname}`, stream: body.stream, cohort: body.cohort });
      showFieldErrors(form, {});
      renderList();
    } catch (err) { toast(err.message, 'error'); showFieldErrors(form, err.details?.fields); }
    setBusy(btn, false);
  });

  const roadmap = createRoadmap(document.getElementById('roadmap-wrap'), {
    editable: true,
    heading: `${p.firstName}'s journey`,
    onToggleRequirement: async (requirementId, completed) => {
      try {
        roadmap.update(await api(`/progress/${id}/requirements/${requirementId}`, { method: 'PUT', body: { completed } }));
        toast(completed ? 'Requirement verified' : 'Requirement unmarked', 'success');
      } catch (err) { toast(err.message, 'error'); throw err; }
    },
    onLinkEvidence: async (requirementId, fileId) => {
      try {
        roadmap.update(await api(`/progress/${id}/requirements/${requirementId}/evidence`, { method: 'PUT', body: { fileId } }));
        toast(fileId ? 'Evidence document linked' : 'Evidence document unlinked', 'success');
      } catch (err) { toast(err.message, 'error'); }
    },
  });
  roadmap.update(await api(`/progress/${id}`));
}

search.addEventListener('input', renderList);
list.addEventListener('click', (e) => { const b = e.target.closest('[data-id]'); if (b) select(Number(b.dataset.id)); });
renderList();
if (!candidates.some((c) => c.id === selected)) selected = candidates[0]?.id;
if (selected) select(selected);

onLive('people', async () => {
  const { candidates: fresh } = await api('/candidates');
  candidates.splice(0, candidates.length, ...fresh);
  renderList();
});
