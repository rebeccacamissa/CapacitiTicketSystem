import { api } from '../api.js';
import { initPage } from '../layout.js';
import { esc, toast, avatarHtml } from '../ui.js';

await initPage({ roles: ['recruiter'] });
const container = document.getElementById('portfolio-list');
try {
  const { portfolios } = await api('/recruiter/portfolios');
  container.innerHTML = portfolios.length ? portfolios.map((portfolio) => `
    <article class="card">
      <header class="flex items-start gap-3">
        ${avatarHtml({ name: portfolio.fullName, avatar: portfolio.avatar, id: portfolio.id }, 'h-12 w-12 text-sm')}
        <div class="min-w-0 flex-1"><h2 class="font-display text-lg font-semibold">${esc(portfolio.fullName)}</h2>
          <p class="text-sm text-white/55">${esc(portfolio.headline || portfolio.stream || 'Candidate portfolio')}</p>
          <p class="mt-1 text-xs text-white/45">${esc(portfolio.email)}</p></div>
      </header>
      ${portfolio.summary ? `<p class="mt-4 text-sm leading-relaxed text-white/65">${esc(portfolio.summary)}</p>` : ''}
      ${portfolio.skills.length ? `<div class="mt-3 flex flex-wrap gap-2">${portfolio.skills.map((skill) => `<span class="chip">${esc(skill)}</span>`).join('')}</div>` : ''}
      <div class="mt-4 flex flex-wrap gap-2">
        ${portfolio.githubUrl ? `<a class="btn btn-ghost btn-sm" href="${esc(portfolio.githubUrl)}" target="_blank" rel="noopener noreferrer">GitHub</a>` : ''}
        ${portfolio.cvUrl ? `<a class="btn btn-ghost btn-sm" href="${esc(portfolio.cvUrl)}" target="_blank" rel="noopener noreferrer">CV</a>` : ''}
        <a class="btn btn-ghost btn-sm" href="/candidate-profiles?id=${portfolio.id}">Candidate profile</a>
      </div>
      <div class="mt-5 border-t border-white/10 pt-4"><h3 class="text-sm font-semibold">Projects & evidence</h3>
        ${portfolio.projects.length ? `<ul class="mt-2 space-y-2">${portfolio.projects.map((project) => `
          <li class="rounded-xl bg-white/[0.04] p-3"><p class="font-medium">${esc(project.title)}</p><p class="mt-1 text-sm text-white/55">${esc(project.description || '')}</p>
            <div class="mt-2 flex gap-3 text-xs">${project.projectUrl ? `<a class="text-salmon-50 hover:underline" href="${esc(project.projectUrl)}" target="_blank" rel="noopener noreferrer">Project link</a>` : ''}
              ${project.evidenceUrl ? `<a class="text-salmon-50 hover:underline" href="${esc(project.evidenceUrl)}" target="_blank" rel="noopener noreferrer">Evidence</a>` : ''}</div>
          </li>`).join('')}</ul>`
        : '<p class="mt-2 text-sm text-white/50">No project evidence has been shared yet.</p>'}
      </div>
    </article>`).join('') : '<div class="card text-center text-sm text-white/55 xl:col-span-2">No shared candidate portfolios yet</div>';
} catch (error) {
  container.innerHTML = '<div class="card text-center text-sm text-salmon-50 xl:col-span-2">Could not load portfolios.</div>';
  toast(error.message, 'error');
}
