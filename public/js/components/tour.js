// First-login walkthrough narrated by Cammy. Spotlights real UI elements ([data-tour="…"]).
import { api } from '../api.js';
import { esc, reduceMotion, t } from '../ui.js';
import { icon } from '../icons.js';
import { renderAvatar } from './avatar.js';

const COMMON_START = [
  { el: 'cammy', title: "Hi, I'm Cammy", body: "I'm your CAPACITI assistant. I'll show you around. It only takes a minute, and you can replay this any time by asking me for a tour." },
  { el: 'nav', title: 'Your menu', body: 'Everything for your role lives here. The card at the top always shows which role you are signed in as.' },
];
const COMMON_END = [
  { el: 'search', title: 'Search anything', body: 'Press Ctrl + K (Cmd + K on a Mac) anywhere to search requests, jump to pages and run quick actions.' },
  { el: 'bell', title: 'Live notifications', body: 'Updates arrive instantly, with no need to refresh. New replies, status changes and birthdays appear here.' },
  { el: 'a11y', title: 'Accessibility', body: 'Larger text, high contrast, easier fonts, read aloud, a reading guide and more. Press A at any time to open these settings, or ? to see all keyboard shortcuts.' },
  { el: 'theme', title: 'Light or dark', body: 'Switch between light and dark themes here.' },
  { el: 'cammy', title: 'I wear your avatar', body: 'Design your avatar in the Avatar studio. Choose Everyday, Fashion Doll Glam, Tactical Operator or Runway Dress-Up. Earn badges to unlock more outfits. Click me whenever you need help.' },
];
const STEPS = {
  candidate: [
    ...COMMON_START,
    { el: 'hero', title: 'Your dashboard', body: 'Your level and XP grow as you progress. Raise a request or chat to me from here.' },
    { el: 'roadmap', title: 'Your journey', body: 'This roadmap tracks you from screening to internship. Click any milestone to see what is done and what is left.' },
    { el: 'birthday', title: 'Birthday countdown', body: "We'll celebrate with you. Only your day and month are ever shown to others." },
    { el: 'feed', title: 'Cohort feed', body: 'Announcements, milestone shout-outs and birthdays from your cohort. React to cheer people on.' },
    ...COMMON_END,
  ],
  support: [
    ...COMMON_START,
    { el: 'queue', title: 'Incoming tickets', body: 'New, unassigned requests land here, highest priority first. Use "Assign to me" to pick one up.' },
    { el: 'workload', title: 'Team workload', body: 'See who is carrying what, including overdue cases and satisfaction ratings.' },
    { el: 'trend', title: 'Trends', body: 'Requests created versus resolved over the last two weeks. Hover or use the arrow keys to read each day.' },
    ...COMMON_END,
  ],
  admin: [
    ...COMMON_START,
    { el: 'add-user', title: 'Add users', body: 'Create staff or candidate accounts. A temporary password is generated, and they must change it at first sign-in.' },
    { el: 'users', title: 'Users & roles', body: 'Change roles, reset passwords, deactivate or remove users from this table.' },
    { el: 'categories', title: 'Categories', body: 'Configure request categories. "Blocker" categories show as support intervention on candidate roadmaps.' },
    ...COMMON_END,
  ],
};
const HOME = { candidate: '/dashboard', support: '/insights', admin: '/admin' };

let running = false;

export function startTour(user, { avatar } = {}) {
  if (running) return;
  if (location.pathname !== HOME[user.role]) { location.href = `${HOME[user.role]}?tour=1`; return; }
  running = true;
  const steps = STEPS[user.role];
  let i = 0;

  const spot = document.createElement('div');
  spot.className = 'tour-spot';
  const card = document.createElement('div');
  card.className = 'glass-strong fixed z-[86] w-[min(24rem,calc(100vw-1.5rem))] p-5 text-white shadow-2xl transition-all duration-300';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-live', 'polite');
  const blocker = document.createElement('div');
  blocker.className = 'fixed inset-0 z-[84]';
  document.body.append(blocker, spot, card);

  const target = (s) => {
    const el = document.querySelector(`[data-tour="${s.el}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return r.width && r.height ? el : null;
  };

  async function go(n) {
    // skip steps whose element isn't on screen (e.g. sidebar hidden on mobile)
    while (n >= 0 && n < steps.length && !target(steps[n])) n += n >= i ? 1 : -1;
    if (n < 0) n = 0;
    if (n >= steps.length) return finish(true);
    i = n;
    const el = target(steps[i]);
    el.scrollIntoView({ block: 'center', behavior: reduceMotion() ? 'auto' : 'smooth' });
    await new Promise((r) => setTimeout(r, reduceMotion() ? 0 : 380));
    const r = el.getBoundingClientRect();
    const pad = 8;
    Object.assign(spot.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });

    const s = steps[i];
    card.innerHTML = `
      <div class="flex items-start gap-3">
        <span class="h-14 w-14 shrink-0 overflow-hidden rounded-2xl ring-2 ring-salmon/60">${renderAvatar(avatar, { crop: 'head', state: i === steps.length - 1 ? 'celebrating' : 'talking', label: 'Cammy' })}</span>
        <div class="min-w-0">
          <p class="text-[0.65rem] font-semibold tracking-[0.18em] text-salmon-50 uppercase">Cammy · ${t('step {n} of {total}', { n: i + 1, total: steps.length })}</p>
          <h2 class="mt-0.5 text-lg" id="tour-title">${esc(s.title)}</h2>
        </div>
      </div>
      <p class="mt-3 text-sm leading-relaxed text-white/75">${esc(s.body)}</p>
      <div class="mt-4 h-1 overflow-hidden rounded-full bg-white/10"><div class="h-full rounded-full bg-gradient-to-r from-purple to-salmon transition-all duration-500" style="width:${((i + 1) / steps.length) * 100}%"></div></div>
      <div class="mt-4 flex items-center justify-between gap-2">
        <button type="button" data-skip class="text-sm text-white/55 hover:text-white">Skip tour</button>
        <div class="flex gap-2">
          ${i > 0 ? `<button type="button" data-prev class="btn btn-ghost btn-sm">${icon('arrowLeft', 'h-4 w-4')}Back</button>` : ''}
          <button type="button" data-next class="btn btn-primary btn-sm">${i === steps.length - 1 ? 'Finish' : 'Next'}${icon('arrowRight', 'h-4 w-4')}</button>
        </div>
      </div>`;
    card.setAttribute('aria-labelledby', 'tour-title');

    // place the card below the target, or above if there's no room; bottom sheet on small screens
    const cw = card.offsetWidth, ch = card.offsetHeight;
    let top, left;
    if (innerWidth < 640) { left = (innerWidth - cw) / 2; top = innerHeight - ch - 12; }
    else {
      left = Math.min(innerWidth - cw - 12, Math.max(12, r.left + r.width / 2 - cw / 2));
      top = r.bottom + 18 + ch < innerHeight ? r.bottom + 18 : Math.max(12, r.top - ch - 18);
      if (r.height > innerHeight * 0.6) { top = Math.max(12, Math.min(innerHeight - ch - 12, r.top + 20)); left = r.right + 18 + cw < innerWidth ? r.right + 18 : Math.max(12, r.left - cw - 18); }
    }
    Object.assign(card.style, { left: `${left}px`, top: `${top}px` });
    card.querySelector('[data-next]').focus();
  }

  async function finish(completed) {
    running = false;
    spot.remove(); card.remove(); blocker.remove();
    document.removeEventListener('keydown', onKey);
    removeEventListener('resize', onResize);
    history.replaceState(null, '', location.pathname);
    try {
      const res = await api('/profile/tour', { method: 'POST', body: { done: true } });
      document.dispatchEvent(new CustomEvent('cammy:badges', { detail: res.badges || [] }));
      document.dispatchEvent(new CustomEvent('cammy:say', { detail: { text: completed ? t("That's the tour! Ask me anything, any time.") : t('No problem. Ask me for a tour whenever you like.'), state: completed ? 'celebrating' : 'idle' } }));
    } catch { /* ignore */ }
  }

  card.addEventListener('click', (e) => {
    if (e.target.closest('[data-next]')) go(i + 1);
    if (e.target.closest('[data-prev]')) go(i - 1);
    if (e.target.closest('[data-skip]')) finish(false);
  });
  const onKey = (e) => {
    if (e.key === 'Escape') finish(false);
    if (e.key === 'ArrowRight') go(i + 1);
    if (e.key === 'ArrowLeft') go(i - 1);
  };
  const onResize = () => go(i);
  document.addEventListener('keydown', onKey);
  addEventListener('resize', onResize);
  go(0);
}
