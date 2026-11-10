import { api } from '../api.js';
import { initPage } from '../layout.js';
import { esc, toast, avatarHtml, fmtDate, openModal, showFieldErrors, setBusy } from '../ui.js';
import { icon } from '../icons.js';
import { shortlistButton, wireShortlist } from '../components/shortlist.js';
import { stageBadge } from '../components/stage-ui.js';

await initPage({ roles: ['recruiter'] });
const list = document.getElementById('profile-list');
const search = document.getElementById('profile-search');
const detail = document.getElementById('profile-detail');
let candidates = [];
let selectedId = Number(new URLSearchParams(location.search).get('id')) || null;

function renderList() {
  const term = search.value.trim().toLocaleLowerCase();
  const visible = candidates.filter((candidate) =>
    !term || [candidate.fullName, candidate.email, candidate.stream, ...candidate.skills].some((value) => value.toLocaleLowerCase().includes(term))
  );
  list.innerHTML = visible.map((candidate) => `
    <li><button type="button" role="option" aria-selected="${candidate.id === selectedId}" data-id="${candidate.id}"
      class="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition hover:bg-white/[0.06] aria-selected:bg-gradient-to-r aria-selected:from-purple/40 aria-selected:to-salmon/20">
      ${avatarHtml({ name: candidate.fullName, avatar: candidate.avatar, id: candidate.id }, 'h-10 w-10 text-xs')}
      <span class="min-w-0"><span class="block truncate text-sm font-medium">${esc(candidate.fullName)}</span><span class="block truncate text-xs text-white/50">${esc(candidate.stream || candidate.email)}</span></span>
    </button></li>`).join('') || '<li class="p-3 text-sm text-white/50">No shared candidate portfolios yet</li>';
}

async function selectCandidate(id) {
  selectedId = id;
  history.replaceState(null, '', `?id=${id}`);
  renderList();
  const { profile } = await api(`/recruiter/profiles/${id}`);
  const links = [
    profile.githubUrl && `<a class="btn btn-ghost btn-sm" href="${esc(profile.githubUrl)}" target="_blank" rel="noopener noreferrer">GitHub</a>`,
    profile.cvUrl && `<a class="btn btn-ghost btn-sm" href="${esc(profile.cvUrl)}" target="_blank" rel="noopener noreferrer">CV</a>`,
  ].filter(Boolean).join('');
  detail.innerHTML = `
    <section class="glass relative overflow-hidden p-6">
      <div class="absolute inset-0 bg-gradient-to-r from-purple/30 to-salmon/20"></div>
      <div class="relative flex flex-wrap items-center gap-4">
        ${avatarHtml({ name: profile.fullName, avatar: profile.avatar, id: profile.id }, 'h-16 w-16 text-xl')}
        <div class="min-w-0 flex-1"><h2 class="text-2xl">${esc(profile.fullName)}</h2><p class="text-sm text-white/65">${esc(profile.email)}</p>
          <div class="mt-2 flex flex-wrap gap-2">${profile.stream ? `<span class="chip">${esc(profile.stream)}</span>` : ''}${profile.cohort ? `<span class="chip">${esc(profile.cohort)}</span>` : ''}${stageBadge(profile.stage, profile.stageLabel)}</div>
        </div><div class="flex flex-wrap gap-2">${links}${shortlistButton(profile)}<button type="button" class="btn btn-primary btn-sm" data-interview>${icon('calendar', 'h-4 w-4')}Request interview</button><button type="button" class="btn btn-ghost btn-sm" data-hire>${icon('trophy', 'h-4 w-4')}Report a hire</button></div>
      </div>
      ${profile.headline ? `<h3 class="relative mt-5 text-lg font-semibold">${esc(profile.headline)}</h3>` : ''}
      ${profile.summary ? `<p class="relative mt-2 whitespace-pre-wrap text-sm leading-relaxed text-white/70">${esc(profile.summary)}</p>` : ''}
      ${profile.skills.length ? `<div class="relative mt-4 flex flex-wrap gap-2">${profile.skills.map((skill) => `<span class="chip">${esc(skill)}</span>`).join('')}</div>` : ''}
    </section>
    <section class="card"><h3 class="text-lg">Verified credentials</h3>
      ${profile.verifiedCredentials.length ? `<ul class="mt-3 space-y-2">${profile.verifiedCredentials.map((credential) => `
        <li class="rounded-xl border border-white/10 bg-white/[0.04] p-3"><p class="font-medium">${esc(credential.label)}</p>
          <p class="mt-1 text-xs text-white/55">${esc(credential.milestone)} · verified ${fmtDate(credential.verifiedAt)}${credential.verifiedBy ? ` by ${esc(credential.verifiedBy)}` : ''}</p></li>`).join('')}</ul>`
      : '<p class="mt-2 text-sm text-white/50">No verified credentials have been shared yet.</p>'}
    </section>
    <section class="card"><div class="flex items-center justify-between gap-3"><h3 class="text-lg">Projects & evidence</h3><a href="/portfolios" class="text-sm font-semibold text-salmon-50 hover:underline">All portfolios</a></div>
      ${profile.projects.length ? `<ul class="mt-3 space-y-2">${profile.projects.map((project) => `
        <li class="rounded-xl border border-white/10 bg-white/[0.04] p-3"><p class="font-medium">${esc(project.title)}</p><p class="mt-1 text-sm text-white/60">${esc(project.description || '')}</p>
          <div class="mt-2 flex gap-3 text-xs">${project.projectUrl ? `<a class="text-salmon-50 hover:underline" href="${esc(project.projectUrl)}" target="_blank" rel="noopener noreferrer">Project link</a>` : ''}
            ${project.evidenceUrl ? `<a class="text-salmon-50 hover:underline" href="${esc(project.evidenceUrl)}" target="_blank" rel="noopener noreferrer">Evidence</a>` : ''}</div></li>`).join('')}</ul>`
      : '<p class="mt-2 text-sm text-white/50">No project evidence has been shared yet.</p>'}
    </section>
    <section class="card"><h3 class="text-lg">Documents</h3>
      ${profile.files?.length ? `<ul class="mt-3 grid gap-2 sm:grid-cols-2">${profile.files.map((f) => `
        <li><a href="/api/portfolio/files/${f.id}" target="_blank" rel="noopener" class="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-3 transition hover:bg-white/[0.08]">
          <span class="text-salmon-50">${icon(f.mime.startsWith('image/') ? 'image' : 'file', 'h-5 w-5')}</span>
          <span class="min-w-0 flex-1"><span class="block truncate text-sm font-medium">${esc(f.title)}</span><span class="block text-xs text-white/50">${esc({ cv: 'CV', project: 'Project', certificate: 'Certificate' }[f.kind])}${f.source === 'ai_tailored' ? ' · AI-tailored, reviewed by the candidate' : ''} · ${fmtDate(f.createdAt)}</span></span>
          ${icon('download', 'h-4 w-4 text-white/50')}</a></li>`).join('')}</ul>`
      : '<p class="mt-2 text-sm text-white/50">No documents have been shared yet.</p>'}
    </section>
    ${profile.interviews?.length ? `<section class="card"><h3 class="text-lg">My interview requests</h3>
      <ul class="mt-3 space-y-2">${profile.interviews.map((i) => `<li class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.04] p-3 text-sm">
        <span>${esc(i.roleTitle)} · ${esc(i.company)} <span class="text-xs text-white/50">· ${fmtDate(i.createdAt)}</span></span>
        <span class="badge ${i.status === 'accepted' ? 'bg-ok/15 text-ok' : i.status === 'pending' ? 'bg-warn/15 text-warn' : 'bg-white/10 text-white/60'}">${esc(i.status)}</span></li>`).join('')}</ul>
    </section>` : ''}`;
}

list.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-id]');
  if (!button) return;
  try { await selectCandidate(Number(button.dataset.id)); }
  catch (error) { toast(error.message, 'error'); }
});
search.addEventListener('input', renderList);
wireShortlist(detail, (id) => selectCandidate(id));
function nameOf(id) { return candidates.find((c) => c.id === id)?.fullName || 'this candidate'; }

function openInterviewForm(candidateId) {
  const m = openModal(`
    <form class="p-6" novalidate>
      <h2 class="text-xl">Request an interview with ${esc(nameOf(candidateId))}</h2>
      <p class="mt-1 text-sm text-white/60">The candidate is notified by email and on their dashboard, and can accept or decline. Programme staff can see interview requests.</p>
      <div class="mt-5 grid gap-4 sm:grid-cols-2">
        <div><label for="iv-company" class="field-label">Company</label><input id="iv-company" name="company" class="field" required maxlength="120"><p class="field-error" data-error-for="company"></p></div>
        <div><label for="iv-role" class="field-label">Role</label><input id="iv-role" name="roleTitle" class="field" required maxlength="120"><p class="field-error" data-error-for="roleTitle"></p></div>
        <div><label for="iv-when" class="field-label">Proposed date and time <span class="font-normal text-white/50">(optional)</span></label><input id="iv-when" name="proposedAt" type="datetime-local" class="field"><p class="field-error" data-error-for="proposedAt"></p></div>
        <div><label for="iv-mode" class="field-label">Format</label><select id="iv-mode" name="mode" class="field"><option value="online">Online</option><option value="in-person">In person</option><option value="phone">Phone</option></select></div>
        <div class="sm:col-span-2"><label for="iv-msg" class="field-label">Message <span class="font-normal text-white/50">(optional)</span></label><textarea id="iv-msg" name="message" rows="3" maxlength="1000" class="field"></textarea></div>
      </div>
      <div class="mt-6 flex justify-end gap-2"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary">Send request</button></div>
    </form>`, { wide: true });
  const form = m.el.querySelector('form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = { candidateId, company: form.company.value.trim(), roleTitle: form.roleTitle.value.trim(), proposedAt: form.proposedAt.value || undefined, mode: form.mode.value, message: form.message.value.trim() || undefined };
    if (!showFieldErrors(form, { ...(body.company.length < 2 ? { company: 'Enter the company' } : {}), ...(body.roleTitle.length < 2 ? { roleTitle: 'Enter the role' } : {}) })) return;
    const btn = form.querySelector('.btn-primary');
    setBusy(btn, true, 'Sending…');
    try {
      await api('/recruiter/interviews', { method: 'POST', body });
      m.close();
      toast('Interview request sent', 'success');
      selectCandidate(candidateId);
    } catch (err) { setBusy(btn, false); showFieldErrors(form, err.details?.fields || {}); toast(err.message, 'error'); }
  });
}

function openHireForm(candidateId) {
  const m = openModal(`
    <form class="p-6" novalidate>
      <h2 class="text-xl">Report a hire: ${esc(nameOf(candidateId))}</h2>
      <p class="mt-1 text-sm text-white/60">The candidate's facilitator confirms the placement. Confirming moves them to the official stage <strong>Placed</strong> (they must be Work Ready first).</p>
      <div class="mt-5 grid gap-4 sm:grid-cols-2">
        <div><label for="h-company" class="field-label">Partner company</label><input id="h-company" name="company" class="field" required maxlength="120"><p class="field-error" data-error-for="company"></p></div>
        <div><label for="h-role" class="field-label">Role</label><input id="h-role" name="roleTitle" class="field" required maxlength="120"><p class="field-error" data-error-for="roleTitle"></p></div>
        <div><label for="h-start" class="field-label">Start date <span class="font-normal text-white/50">(optional)</span></label><input id="h-start" name="startDate" type="date" class="field"></div>
        <div class="sm:col-span-2"><label for="h-note" class="field-label">Note for the facilitator <span class="font-normal text-white/50">(optional)</span></label><textarea id="h-note" name="note" rows="2" maxlength="1000" class="field"></textarea></div>
      </div>
      <div class="mt-6 flex justify-end gap-2"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary">Report hire</button></div>
    </form>`, { wide: true });
  const form = m.el.querySelector('form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = { candidateId, company: form.company.value.trim(), roleTitle: form.roleTitle.value.trim(), startDate: form.startDate.value || undefined, note: form.note.value.trim() || undefined };
    if (!showFieldErrors(form, { ...(body.company.length < 2 ? { company: 'Enter the company' } : {}), ...(body.roleTitle.length < 2 ? { roleTitle: 'Enter the role' } : {}) })) return;
    const btn = form.querySelector('.btn-primary');
    setBusy(btn, true, 'Sending…');
    try {
      await api('/recruiter/placements', { method: 'POST', body });
      m.close();
      toast('Hire reported. The facilitator will confirm it.', 'success');
    } catch (err) { setBusy(btn, false); showFieldErrors(form, err.details?.fields || {}); toast(err.message, 'error'); }
  });
}

detail.addEventListener('click', (e) => {
  if (e.target.closest('[data-interview]')) openInterviewForm(selectedId);
  if (e.target.closest('[data-hire]')) openHireForm(selectedId);
});

try {
  ({ candidates } = await api('/recruiter/talent'));
  renderList();
  if (!candidates.length) {
    detail.innerHTML = '<div class="card text-sm text-white/50">No shared candidate portfolios yet</div>';
  } else {
    if (!candidates.some((candidate) => candidate.id === selectedId)) selectedId = candidates[0].id;
    await selectCandidate(selectedId);
  }
} catch (error) {
  list.innerHTML = '<li class="p-3 text-sm text-salmon-50">Could not load profiles.</li>';
  toast(error.message, 'error');
}
