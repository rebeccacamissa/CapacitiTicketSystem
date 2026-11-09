import { api } from '../api.js';
import { initPage } from '../layout.js';
import { esc, toast, avatarHtml, fmtDate } from '../ui.js';

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
          <div class="mt-2 flex flex-wrap gap-2">${profile.stream ? `<span class="chip">${esc(profile.stream)}</span>` : ''}${profile.cohort ? `<span class="chip">${esc(profile.cohort)}</span>` : ''}<span class="chip">${esc(profile.stageLabel)}</span></div>
        </div>${links ? `<div class="flex gap-2">${links}</div>` : ''}
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
    </section>`;
}

list.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-id]');
  if (!button) return;
  try { await selectCandidate(Number(button.dataset.id)); }
  catch (error) { toast(error.message, 'error'); }
});
search.addEventListener('input', renderList);

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
