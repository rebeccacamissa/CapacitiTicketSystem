import { api } from '../api.js';
import { initPage } from '../layout.js';
import { esc, toast, setBusy, showFieldErrors, fmtDate, t } from '../ui.js';
import { icon } from '../icons.js';
import { onLive } from '../live.js';
import { stageBadge, decisionItem } from '../components/stage-ui.js';

const user = await initPage({ roles: ['admin', 'facilitator'] });
const isAdmin = user.role === 'admin';
const BACKWARD_MIN = 10;
const form = document.getElementById('decide');
const params = new URLSearchParams(location.search);
let candidates = [];
let stages = [];
let decisions = [];
let focus = Number(params.get('candidate')) || null;

document.getElementById('back-rule').textContent = isAdmin
  ? t('As an administrator you can also move a candidate back a stage, with a written reason.')
  : t('Only an administrator can move a candidate back a stage.');
document.getElementById('trail-scope').textContent = isAdmin ? t('Every stage decision, newest first.') : t('Decisions for candidates in your streams.');

async function loadCandidates() {
  ({ candidates, stages } = await api('/stages/candidates'));
  const keep = Number(form.candidate.value) || focus;
  form.candidate.innerHTML = candidates.length
    ? candidates.map((c) => `<option value="${c.id}">${esc(c.fullName)} · ${esc(t(c.stageLabel))}${c.readyForReview ? ` · ${t('ready for review')}` : ''}</option>`).join('')
    : `<option value="">${t('No candidates in your streams')}</option>`;
  if (keep && candidates.some((c) => c.id === keep)) form.candidate.value = String(keep);
  await renderCandidate();
}

async function renderCandidate() {
  const c = candidates.find((x) => x.id === Number(form.candidate.value));
  const box = document.getElementById('sd-current');
  if (!c) { box.innerHTML = ''; form.toStage.innerHTML = ''; return; }
  const rm = await api(`/progress/${c.id}`);
  const current = rm.milestones[rm.activeIndex];
  const missing = current.requirements.filter((r) => !r.completed);
  box.innerHTML = `
    <div class="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div class="flex flex-wrap items-center gap-2 text-sm"><span class="text-white/60">${t('Current official stage')}</span>${stageBadge(c.stage, c.stageLabel)}<span class="text-xs text-white/45">${t('since {date}', { date: fmtDate(rm.stage.since) })}</span></div>
      ${current.totalCount ? `<p class="mt-3 text-sm font-medium">${t('Exit criteria evidenced: {done} of {total}', { done: current.completedCount, total: current.totalCount })}</p>
        ${missing.length ? `<ul class="mt-1 list-disc pl-5 text-xs text-warn">${missing.map((r) => `<li>${t('Not yet evidenced')}: ${esc(t(r.label))}</li>`).join('')}</ul>
          <p class="mt-2 text-xs text-white/55">${t('Evidence supports the decision but does not block it. Explain any gaps in your reason.')}</p>`
        : `<p class="mt-1 flex items-center gap-1.5 text-xs text-ok">${icon('checkCircle', 'h-3.5 w-3.5')}${t('Every exit criterion is evidenced.')}</p>`}` : ''}
      <a href="/candidates?id=${c.id}" class="mt-3 inline-flex text-xs font-semibold text-salmon-50 hover:underline">${t('Open evidence and roadmap')}</a>
    </div>`;

  // Facilitators: only the next stage. Admins: next stage, or any earlier stage (backward).
  const order = stages.findIndex((s) => s.key === c.stage);
  const opts = [];
  if (stages[order + 1]) opts.push(`<option value="${stages[order + 1].key}">${t('Approve: {stage}', { stage: t(stages[order + 1].label) })}</option>`);
  if (isAdmin) for (let i = order - 1; i >= 0; i -= 1) opts.push(`<option value="${stages[i].key}" data-back="1">${t('Move back to: {stage}', { stage: t(stages[i].label) })}</option>`);
  form.toStage.innerHTML = opts.join('') || `<option value="">${t('Programme completed: no further stages')}</option>`;
  form.toStage.disabled = !opts.length;
  document.getElementById('sd-submit').disabled = !opts.length;
  syncButton();
  if (focus) { focus = c.id; renderTrail(); }
}

function syncButton() {
  const back = form.toStage.selectedOptions[0]?.dataset.back;
  const btn = document.getElementById('sd-submit');
  btn.textContent = back ? t('Move back a stage') : t('Approve decision');
  btn.classList.toggle('btn-primary', !back);
  btn.classList.toggle('btn-ghost', !!back);
  form.reason.placeholder = back ? t('Required: explain clearly why the candidate is moving back a stage.') : t('e.g. All assessments passed with 85% attendance; capstone submitted.');
}

form.candidate.addEventListener('change', () => { focus = Number(form.candidate.value); history.replaceState(null, '', `?candidate=${focus}`); renderCandidate(); });
form.toStage.addEventListener('change', syncButton);

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const c = candidates.find((x) => x.id === Number(form.candidate.value));
  const opt = form.toStage.selectedOptions[0];
  if (!c || !opt?.value) return;
  const back = !!opt.dataset.back;
  const reason = form.reason.value.trim();
  const errs = {};
  if (reason.length < 3) errs.reason = t('A reason is required');
  if (back && reason.length < BACKWARD_MIN) errs.reason = t('Write at least {n} characters explaining why', { n: BACKWARD_MIN });
  showFieldErrors(form, errs);
  if (Object.keys(errs).length) return;
  if (back && !confirm(t('Move {name} back to {stage}? This is recorded in the audit trail.', { name: c.fullName, stage: opt.textContent }))) return;

  const btn = document.getElementById('sd-submit');
  setBusy(btn, true, 'Saving…');
  try {
    const res = await api(`/stages/candidates/${c.id}/decisions`, { method: 'POST', body: { toStage: opt.value, reason } });
    toast(t('{name} is now at {stage}', { name: c.fullName, stage: t(res.decision.toLabel) }), 'success');
    form.reason.value = '';
    await Promise.all([loadCandidates(), loadTrail()]);
  } catch (err) {
    toast(err.message, 'error');
    showFieldErrors(form, err.details?.fields);
  }
  setBusy(btn, false);
  syncButton();
});

// ---- Audit trail --------------------------------------------------------------
async function loadTrail() {
  ({ decisions } = await api('/stages/decisions', { query: { limit: 300 } }));
  renderTrail();
}

function renderTrail() {
  const q = document.getElementById('trail-search').value.trim().toLowerCase();
  const rows = decisions.filter((d) => (!focus || d.candidateId === focus)
    && (!q || [d.candidateName, d.reason, d.decidedBy, d.stream].some((v) => (v || '').toLowerCase().includes(q))));
  document.getElementById('trail-all').classList.toggle('hidden', !focus);
  document.getElementById('trail').innerHTML = rows.length
    ? rows.map((d) => decisionItem(d)).join('')
    : `<li class="rounded-2xl border border-dashed border-white/15 p-6 text-center text-sm text-white/55">${t('No stage decisions yet.')}</li>`;
}
document.getElementById('trail-search').addEventListener('input', renderTrail);
document.getElementById('trail-all').addEventListener('click', () => { focus = null; history.replaceState(null, '', location.pathname); renderTrail(); });

await Promise.all([loadCandidates(), loadTrail()]);
onLive('people', () => Promise.all([loadCandidates(), loadTrail()]));
