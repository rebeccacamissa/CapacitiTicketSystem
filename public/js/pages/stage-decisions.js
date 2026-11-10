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
    ? candidates.map((c) => `<option value="${c.id}">${esc(c.fullName)} · ${esc(t(c.stageLabel))}${c.readyForReview || c.reviewRequested ? ` · ${t('ready for review')}` : ''}${c.overdue ? ` · ${t('past target')}` : ''}</option>`).join('')
    : `<option value="">${t('No candidates in your streams')}</option>`;
  if (keep && candidates.some((c) => c.id === keep)) form.candidate.value = String(keep);
  renderInbox();
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

// ---- Approval inbox (batch) ------------------------------------------------------
const inbox = document.getElementById('inbox');
const inboxForm = document.getElementById('inbox-form');
const approveBtn = document.getElementById('inbox-approve');
function renderInbox() {
  const ready = candidates.filter((c) => c.nextStage && (c.readyForReview || c.reviewRequested));
  inbox.innerHTML = ready.length ? ready.map((c) => `
    <li><label class="flex cursor-pointer items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3 transition hover:bg-white/[0.07] has-[:checked]:border-salmon/50 has-[:checked]:bg-salmon/[0.08]">
      <input type="checkbox" value="${c.id}" class="mt-1 h-4 w-4 accent-salmon" data-inbox>
      <span class="min-w-0 flex-1">
        <span class="block font-medium">${esc(c.fullName)}</span>
        <span class="mt-1 flex flex-wrap items-center gap-1 text-xs">${stageBadge(c.stage, c.stageLabel)}${icon('arrowRight', 'h-3 w-3 text-white/50')}${stageBadge(c.nextStage.key, c.nextStage.label)}
          <span class="text-white/50">· ${t('{done} of {total} evidenced', { done: c.evidenceDone, total: c.evidenceTotal })}</span></span>
        ${c.reviewRequested ? `<span class="mt-1 block text-xs text-salmon-50">${icon('flag', 'h-3 w-3 inline')} ${t('Candidate asked for a review')}${c.reviewNote ? `: <span translate="no">${esc(c.reviewNote)}</span>` : ''}</span>` : ''}
        ${c.overdue ? `<span class="mt-1 block text-xs text-warn">${icon('clock', 'h-3 w-3 inline')} ${t('{days} days in stage (target {target})', { days: c.daysInStage, target: c.targetDays })}</span>` : ''}
      </span>
      <a href="/stage-decisions?candidate=${c.id}" class="text-xs font-semibold text-salmon-50 hover:underline" data-review-one>${t('Review')}</a>
    </label></li>`).join('')
    : `<li class="rounded-2xl border border-dashed border-white/15 p-6 text-center text-sm text-white/55 md:col-span-2">${t('Nobody is waiting for a review right now.')}</li>`;
  syncInbox();
}
function syncInbox() {
  const n = inbox.querySelectorAll('[data-inbox]:checked').length;
  approveBtn.disabled = !n;
  approveBtn.textContent = n ? t('Approve selected ({n})', { n }) : t('Approve selected');
}
inbox.addEventListener('change', syncInbox);
document.getElementById('inbox-all').addEventListener('change', (e) => {
  inbox.querySelectorAll('[data-inbox]').forEach((c) => { c.checked = e.target.checked; });
  syncInbox();
});
inboxForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const candidateIds = [...inbox.querySelectorAll('[data-inbox]:checked')].map((c) => Number(c.value));
  const reason = inboxForm.reason.value.trim();
  if (!showFieldErrors(inboxForm, reason.length >= 3 ? {} : { reason: t('A shared note is required') })) return;
  setBusy(approveBtn, true, 'Approving…');
  try {
    const out = await api('/stages/batch', { method: 'POST', body: { candidateIds, reason } });
    toast(t('{ok} approved{failed}', { ok: out.approved, failed: out.failed ? `, ${out.failed} could not be approved` : '' }), out.failed ? 'error' : 'success');
    for (const r of out.results.filter((x) => !x.ok)) toast(`${candidates.find((c) => c.id === r.candidateId)?.fullName || r.candidateId}: ${r.error}`, 'error');
    inboxForm.reset();
    document.getElementById('inbox-all').checked = false;
    await Promise.all([loadCandidates(), loadTrail()]);
  } catch (err) { toast(err.message, 'error'); showFieldErrors(inboxForm, err.details?.fields); }
  setBusy(approveBtn, false);
  syncInbox();
});

// ---- Placements --------------------------------------------------------------------
async function loadPlacements() {
  const { placements } = await api('/stages/placements');
  const list = document.getElementById('pl-list');
  list.innerHTML = placements.length ? placements.map((p) => `
    <li class="flex flex-wrap items-center gap-3 rounded-2xl border ${p.status === 'pending' ? 'border-salmon/40 bg-salmon/[0.06]' : 'border-white/10 bg-white/[0.03]'} p-3">
      <span class="min-w-0 flex-1"><span class="block font-medium">${esc(p.candidateName)} · ${esc(p.roleTitle)} at ${esc(p.company)}</span>
        <span class="block text-xs text-white/55">${t('Reported by {name}', { name: esc(p.recruiterName || 'a recruiter') })} · ${fmtDate(p.createdAt)}${p.startDate ? ` · ${t('starts {date}', { date: fmtDate(p.startDate) })}` : ''} · ${t('current stage')}: ${esc(t(stages.find((s) => s.key === p.stage)?.label || p.stage))}</span>
        ${p.note ? `<span class="block text-xs text-white/60" translate="no">${esc(p.note)}</span>` : ''}</span>
      ${p.status === 'pending'
        ? `<button class="btn btn-primary btn-sm" data-pl="${p.id}" data-approve="1">${t('Confirm placement')}</button><button class="btn btn-ghost btn-sm" data-pl="${p.id}" data-approve="0">${t('Not confirmed')}</button>`
        : `<span class="badge ${p.status === 'confirmed' ? 'bg-ok/15 text-ok' : 'bg-white/10 text-white/60'}">${esc(t(p.status))}</span>`}
    </li>`).join('') : `<li class="text-sm text-white/55">${t('No placements reported yet.')}</li>`;
}
document.getElementById('pl-list').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-pl]');
  if (!b) return;
  const approve = b.dataset.approve === '1';
  const note = approve ? '' : prompt(t('Why is this placement not confirmed? (shared with the recruiter)')) || '';
  if (!approve && !note.trim()) return;
  b.disabled = true;
  try {
    await api(`/stages/placements/${b.dataset.pl}`, { method: 'POST', body: { approve, note: note.trim() || undefined } });
    toast(approve ? t('Placement confirmed and stage updated') : t('Placement marked as not confirmed'), 'success');
    await Promise.all([loadPlacements(), loadCandidates(), loadTrail()]);
  } catch (err) { toast(err.message, 'error'); b.disabled = false; }
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

await Promise.all([loadCandidates(), loadTrail(), loadPlacements()]);
onLive('people', () => Promise.all([loadCandidates(), loadTrail(), loadPlacements()]));
if (location.hash === '#placements') setTimeout(() => document.getElementById('placements')?.scrollIntoView({ behavior: 'smooth' }), 400);
