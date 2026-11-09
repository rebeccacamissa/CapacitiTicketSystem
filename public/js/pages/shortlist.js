import { api } from '../api.js';
import { initPage } from '../layout.js';
import { esc, toast, avatarHtml, t } from '../ui.js';
import { shortlistButton, wireShortlist } from '../components/shortlist.js';
import { stageBadge } from '../components/stage-ui.js';

await initPage({ roles: ['recruiter'] });
const list = document.getElementById('shortlist');

async function load() {
  const { candidates } = await api('/recruiter/shortlist');
  list.innerHTML = candidates.length ? candidates.map((c) => `
    <li class="glass glow-ring flex flex-col p-5">
      <div class="flex items-center gap-3">
        ${avatarHtml({ name: c.fullName, avatar: c.avatar, id: c.id }, 'h-12 w-12 text-sm')}
        <div class="min-w-0 flex-1"><p class="truncate font-semibold">${esc(c.fullName)}</p><p class="truncate text-xs text-white/50">${esc(c.stream || '')}</p></div>
        ${stageBadge(c.stage, c.stageLabel)}
      </div>
      ${c.headline ? `<p class="mt-3 text-sm text-white/75">${esc(c.headline)}</p>` : ''}
      ${c.skills.length ? `<div class="mt-2 flex flex-wrap gap-1.5">${c.skills.slice(0, 6).map((s) => `<span class="chip !text-[0.7rem]">${esc(s)}</span>`).join('')}</div>` : ''}
      <form class="mt-4" data-note="${c.id}">
        <label for="note-${c.id}" class="field-label">${t('Private note')}</label>
        <textarea id="note-${c.id}" name="note" rows="2" maxlength="500" class="field text-sm" placeholder="${t('Why are they a good fit?')}" translate="no">${esc(c.shortlistNote)}</textarea>
        <div class="mt-2 flex flex-wrap items-center justify-between gap-2">
          <span class="flex gap-2"><a href="/candidate-profiles?id=${c.id}" class="btn btn-ghost btn-sm">${t('View portfolio')}</a>${shortlistButton(c)}</span>
          <button class="btn btn-ghost btn-sm">${t('Save note')}</button>
        </div>
      </form>
    </li>`).join('')
    : `<li class="card md:col-span-2 xl:col-span-3 text-center text-sm text-white/55">${t('Your shortlist is empty. Use the star on the talent board or a candidate profile to save someone.')}</li>`;
}

list.addEventListener('submit', async (e) => {
  const form = e.target.closest('[data-note]');
  if (!form) return;
  e.preventDefault();
  try {
    await api(`/recruiter/shortlist/${form.dataset.note}`, { method: 'PUT', body: { note: form.note.value.trim() } });
    toast(t('Note saved'), 'success');
  } catch (err) { toast(err.message, 'error'); }
});
wireShortlist(list, load);
await load();
