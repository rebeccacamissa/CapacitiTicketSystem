// Cohort feed post card + reaction handling (shared by dashboard widget and /feed).
import { api } from '../api.js';
import { esc, fmtRelative, avatarHtml, toast } from '../ui.js';
import { icon } from '../icons.js';

const KIND = {
  announcement: ['megaphone', 'Announcement', 'from-purple to-purple-80'],
  milestone: ['flag', 'Milestone', 'from-salmon to-purple'],
  badge: ['trophy', 'Badge earned', 'from-warn to-salmon'],
  birthday: ['cake', 'Birthday', 'from-salmon to-pink'],
};
const REACTIONS = [['cheer', 'cheer', 'Cheer'], ['love', 'heart', 'Love'], ['fire', 'fire', 'Fire'], ['star', 'star', 'Star']];

export function feedItem(p, { compact = false, canDelete = false } = {}) {
  const [ic, label, grad] = KIND[p.kind] || KIND.announcement;
  const who = p.author ? `${esc(p.author.name)}${p.author.role !== 'candidate' ? ' <span class="text-white/45">· Programme team</span>' : ''}` : esc(p.person?.name || 'CAPACITI');
  return `
    <li class="group rounded-2xl border border-white/10 bg-white/[0.035] p-${compact ? '3' : '4'} transition hover:border-white/20" data-post="${p.id}">
      <div class="flex items-start gap-3">
        <div class="relative shrink-0">
          ${p.person ? avatarHtml({ name: p.person.name, avatar: p.person.avatar, id: p.person.id }, compact ? 'h-10 w-10 text-xs' : 'h-12 w-12 text-sm') : ''}
          <span class="absolute -right-1 -bottom-1 flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br ${grad} text-snow ring-2 ring-night">${icon(ic, 'h-3 w-3')}</span>
        </div>
        <div class="min-w-0 flex-1">
          <p class="text-xs text-white/50"><span class="font-semibold text-white/80">${label}</span> · ${who} · <time datetime="${p.createdAt}">${fmtRelative(p.createdAt)}</time>${p.cohort ? ` · ${esc(p.cohort)}` : ''}</p>
          <p class="mt-1 text-sm leading-relaxed ${compact ? 'line-clamp-2' : ''}">${esc(p.body)}</p>
          <div class="mt-2 flex flex-wrap items-center gap-1.5">
            ${REACTIONS.map(([key, ricon, name]) => {
              const r = p.reactions[key];
              return `<button type="button" data-react="${key}" aria-pressed="${r.mine}" aria-label="${name}${r.count ? `, ${r.count}` : ''}"
                class="inline-flex items-center gap-1 rounded-full border border-white/10 px-2 py-0.5 text-xs text-white/60 transition hover:scale-105 hover:border-white/25 hover:text-white aria-pressed:border-salmon/50 aria-pressed:bg-salmon/15 aria-pressed:text-salmon-50">
                ${icon(ricon, 'h-3.5 w-3.5')}${r.count ? `<span class="tabular-nums">${r.count}</span>` : ''}</button>`;
            }).join('')}
            ${canDelete ? `<button type="button" data-delete class="ml-auto rounded-full px-2 py-0.5 text-xs text-white/40 opacity-0 transition group-hover:opacity-100 hover:text-salmon-50">Remove</button>` : ''}
          </div>
        </div>
      </div>
    </li>`;
}

export function wireReactions(list, reload) {
  list.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-react]');
    const del = e.target.closest('[data-delete]');
    const post = e.target.closest('[data-post]');
    if (!post) return;
    try {
      if (b) {
        b.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: 300 });
        await api(`/feed/${post.dataset.post}/react`, { method: 'POST', body: { reaction: b.dataset.react } });
        reload();
      } else if (del) {
        await api(`/feed/${post.dataset.post}`, { method: 'DELETE' });
        reload();
      }
    } catch (err) { toast(err.message, 'error'); }
  });
}
