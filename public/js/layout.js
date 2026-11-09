// App shell: animated background, sidebar, top bar (search, theme, role switcher,
// notifications), birthday banner, live updates, Cammy, walkthrough and page transitions.
import { api } from './api.js';
import { esc, avatarHtml, reduceMotion } from './ui.js';
import { icon } from './icons.js';
import { startLive, onLive } from './live.js';
import { initPalette, toggle as togglePalette } from './components/palette.js';
import { t, translateDom, LANGS, getLang, loadLanguage, setLanguage } from './i18n.js';
import { applyA11y, announce, initShortcuts, initVoiceInput, openA11yPanel } from './a11y.js';

export { icon };
export const HOME = { candidate: '/dashboard', support: '/insights', admin: '/admin', recruiter: '/recruiter', facilitator: '/facilitator' };
const ROLE_LABEL_EN = { candidate: 'Candidate', support: 'Support / Manager', admin: 'Administrator', recruiter: 'Recruiter', facilitator: 'Facilitator' };
export const ROLE_LABEL = new Proxy(ROLE_LABEL_EN, { get: (o, k) => t(o[k]) });
const ROLE_BLURB = {
  candidate: 'Your journey, requests and profile',
  support: 'Ticket queue, workload and candidate records',
  admin: 'Users, roles, categories and analytics',
  recruiter: 'Shared candidate talent and portfolios',
  facilitator: 'Stage reviews and evidence for your streams',
};

const NAV = {
  candidate: [
    ['Dashboard', [['/dashboard', 'My dashboard', 'home']]],
    ['Support', [['/requests', 'My requests', 'ticket'], ['/new-request', 'New request', 'plus']]],
    ['Community', [['/feed', 'Cohort feed', 'megaphone']]],
    ['Me', [['/profile', 'Profile & avatar', 'user']]],
  ],
  support: [
    ['Dashboard', [['/insights', 'Support dashboard', 'chart']]],
    ['Work', [['/requests', 'Ticket queue', 'ticket'], ['/candidates', 'Candidates', 'users']]],
    ['Community', [['/feed', 'Cohort feed', 'megaphone']]],
    ['Me', [['/profile', 'Profile & avatar', 'user']]],
  ],
  admin: [
    ['Dashboards', [['/admin', 'Control centre', 'shield'], ['/insights', 'Support analytics', 'chart']]],
    ['Work', [['/requests', 'All requests', 'ticket'], ['/candidates', 'Candidates', 'users'], ['/stage-decisions', 'Stage decisions', 'flag']]],
    ['Community', [['/feed', 'Cohort feed', 'megaphone']]],
    ['Me', [['/profile', 'Profile & avatar', 'user']]],
  ],
  recruiter: [
    ['Recruiter workspace', [['/recruiter', 'Overview', 'home'], ['/talent-board', 'Talent board', 'search'], ['/candidate-profiles', 'Candidate profiles', 'users'], ['/portfolios', 'Portfolios', 'folder'], ['/shortlist', 'My shortlist', 'star']]],
  ],
  facilitator: [
    ['Dashboard', [['/facilitator', 'My streams', 'home']]],
    ['Reviews', [['/stage-decisions', 'Stage approvals', 'flag'], ['/candidates', 'Candidate evidence', 'users']]],
    ['Community', [['/feed', 'Cohort feed', 'megaphone']]],
    ['Me', [['/profile', 'Profile & avatar', 'user']]],
  ],
};

export function brandHtml({ light = true, size = 'h-9' } = {}) {
  const dark = document.documentElement.dataset.theme === 'light';
  return `<a href="/" class="inline-flex items-center" aria-label="CAPACITI home">
    <img src="/assets/${light && !dark ? 'logo-full-light' : 'logo-full'}.png" alt="CAPACITI, a division of UVU Africa" class="${size} w-auto">
  </a>`;
}

/** Apply theme / motion / text-size preferences to <html>. */
export function applyPreferences(p = {}) {
  const root = document.documentElement;
  const theme = p.theme === 'system' ? (matchMedia('(prefers-contrast: more)').matches ? 'contrast' : matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : p.theme || 'dark';
  // Chrome won't re-resolve colour-mix(var()) on elements mid-transition, so switch
  // transitions off for the frame in which the theme variables change.
  root.classList.add('no-transitions');
  root.dataset.theme = theme;
  applyA11y(p);
  void root.offsetWidth;
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('no-transitions')));
  localStorage.setItem('capaciti-prefs', JSON.stringify(p));
}
// Apply cached prefs immediately to avoid a theme flash.
try { applyPreferences(JSON.parse(localStorage.getItem('capaciti-prefs') || '{}')); } catch { /* ignore */ }

/** Animated aurora background (shared with login/register). */
export function backgroundHtml() {
  return `<div class="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden="true">
    <div class="aurora-base absolute inset-0 bg-[radial-gradient(ellipse_at_top,#1d2951_0%,#0d1430_45%,#070b1d_100%)]"></div>
    <div class="aurora-blob absolute -top-40 -left-32 h-[34rem] w-[34rem] rounded-full bg-purple/40 blur-[120px] animate-drift-a"></div>
    <div class="aurora-blob absolute top-1/3 -right-40 h-[30rem] w-[30rem] rounded-full bg-salmon/25 blur-[120px] animate-drift-b"></div>
    <div class="aurora-blob absolute -bottom-40 left-1/4 h-[28rem] w-[28rem] rounded-full bg-kadet-80/40 blur-[110px] animate-drift-c"></div>
    <div class="absolute inset-0 opacity-[0.07] [background-image:linear-gradient(rgb(255_255_255/.5)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/.5)_1px,transparent_1px)] [background-size:56px_56px] [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_75%)]"></div>
  </div>`;
}

let currentUser = null;
export const getUser = () => currentUser;

export async function initPage({ roles } = {}) {
  let user, demoMode;
  try {
    ({ user, demoMode } = await api('/auth/me'));
  } catch {
    return new Promise(() => {}); // api() already redirected
  }
  if (user.mustChangePassword && location.pathname !== '/change-password') {
    location.replace('/change-password');
    return new Promise(() => {});
  }
  if (roles && !roles.includes(user.role)) {
    location.replace(HOME[user.role]);
    return new Promise(() => {});
  }
  currentUser = user;
  if (user.language && user.language !== getLang()) await loadLanguage(user.language);
  document.documentElement.dataset.role = user.role;
  applyPreferences(user.preferences);
  buildShell(user, demoMode);
  return user;
}

function buildShell(user, demoMode) {
  const main = document.getElementById('main');
  const title = main.dataset.title || document.title.split('·')[0].trim();
  const subtitle = main.dataset.subtitle || '';
  document.getElementById('app-header')?.remove();

  const navHtml = NAV[user.role].map(([section, links]) => `
    <p class="mt-5 mb-1.5 px-3 text-[0.65rem] font-semibold tracking-[0.18em] text-white/35 uppercase first:mt-0">${t(section)}</p>
    ${links.map(([href, label, ic]) => `<a href="${href}" class="nav-item" ${location.pathname === href ? 'aria-current="page"' : ''}>${icon(ic)}<span>${t(label)}</span></a>`).join('')}
  `).join('');

  const sidebar = `
    <div class="flex h-full flex-col p-4">
      <div class="flex items-center justify-between px-1 pt-1">${brandHtml({ size: 'h-8' })}
        <button type="button" data-close-drawer class="rounded-xl p-2 text-white/70 hover:bg-white/10 lg:hidden" aria-label="${t('Close menu')}">${icon('close')}</button>
      </div>
      <div class="mt-6 rounded-2xl border border-white/10 bg-gradient-to-br from-purple/30 to-salmon/10 p-3">
        <p class="text-[0.65rem] font-semibold tracking-[0.18em] text-white/50 uppercase">${t('Signed in as')}</p>
        <p class="mt-0.5 font-display font-semibold">${ROLE_LABEL[user.role]}</p>
        <p class="text-xs text-white/55">${t(ROLE_BLURB[user.role])}</p>
        <div class="mt-3" data-level>
          <div class="flex items-center justify-between text-[0.7rem] text-white/60"><span data-level-label>Level —</span><span data-xp-label></span></div>
          <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10"><div data-level-bar class="h-full w-0 rounded-full bg-gradient-to-r from-salmon to-pink transition-all duration-1000"></div></div>
        </div>
      </div>
      <nav class="mt-4 flex-1 overflow-y-auto pl-3 -ml-3" aria-label="Main" data-tour="nav">${navHtml}</nav>
      <div class="mt-4 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-2.5">
        <a href="/profile#avatar" aria-label="${t('Edit your avatar')}" data-side-avatar>${avatarHtml({ name: user.fullName, avatar: user.avatar, id: user.id }, 'h-10 w-10 text-sm', 'transition hover:scale-110')}</a>
        <div class="min-w-0 flex-1"><p class="truncate text-sm font-semibold">${esc(user.fullName)}</p><p class="truncate text-xs text-white/50">${esc(user.email)}</p>${['recruiter', 'facilitator'].includes(user.role) ? `<p class="mt-0.5 text-[0.6rem] font-semibold tracking-wider text-salmon-50">ROLE / ${user.role.toUpperCase()}</p>` : ''}</div>
        <button type="button" data-logout class="rounded-xl p-2 text-white/60 transition hover:bg-salmon/20 hover:text-salmon-50" aria-label="${t('Sign out')}" title="${t('Sign out')}">${icon('logout')}</button>
      </div>
    </div>`;

  const demoBtns = (cls) => ['candidate', 'support', 'admin', 'recruiter', 'facilitator'].map((r) => `<button type="button" data-demo-role="${r}" aria-pressed="${r === user.role}" class="${cls} ${r === user.role ? 'bg-gradient-to-r from-purple to-salmon text-snow shadow' : 'text-white/60 hover:bg-white/10 hover:text-white'}">${t({ candidate: 'Candidate', support: 'Manager', admin: 'Admin', recruiter: 'Recruiter', facilitator: 'Facilitator' }[r])}</button>`).join('');

  const shell = document.createElement('div');
  shell.innerHTML = `
    ${backgroundHtml()}
    <a href="#main" class="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[90] focus:rounded-xl focus:bg-snow focus:px-4 focus:py-2 focus:text-kadet">${t('Skip to content')}</a>
    <aside id="sidebar" class="glass-strong fixed inset-y-3 left-3 z-50 w-[260px] -translate-x-[110%] !rounded-3xl transition-transform duration-300 lg:translate-x-0">${sidebar}</aside>
    <div id="drawer-scrim" class="pointer-events-none fixed inset-0 z-40 bg-ink/60 opacity-0 backdrop-blur-sm transition-opacity duration-300 lg:hidden"></div>
    <div class="min-h-screen lg:pl-[284px]">
      <header class="sticky top-0 z-30 px-4 pt-3 sm:px-6">
        <div class="glass flex items-center gap-2 !rounded-2xl px-3 py-2.5 sm:gap-3 sm:px-4">
          <button type="button" id="open-drawer" class="rounded-xl p-2 text-white/80 hover:bg-white/10 lg:hidden" aria-label="${t('Open menu')}" aria-controls="sidebar" aria-expanded="false">${icon('menu')}</button>
          <div class="min-w-0 flex-1">
            <h1 class="truncate text-lg sm:text-xl">${esc(title)}</h1>
            <p class="hidden truncate text-xs text-white/50 sm:block"><span data-clock>${esc(subtitle)}</span>
              <span class="ml-2 inline-flex items-center gap-1 align-middle" data-live title="${t('Live updates')}"><span class="h-1.5 w-1.5 rounded-full bg-white/30" data-live-dot></span><span data-live-text>${t('Connecting')}</span></span></p>
          </div>
          ${!['recruiter', 'facilitator'].includes(user.role) ? `<button type="button" data-tour="search" data-open-palette class="hidden items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/55 transition hover:border-white/25 hover:text-white md:flex" aria-label="${t('Search')} (Ctrl+K)">
            ${icon('search', 'h-4 w-4')}<span>${t('Search')}</span><kbd class="ml-3 rounded-md border border-white/15 px-1.5 text-[0.65rem]">Ctrl K</kbd>
          </button>
          <button type="button" data-open-palette class="rounded-xl p-2.5 text-white/80 hover:bg-white/10 md:hidden" aria-label="${t('Search')}">${icon('search')}</button>` : ''}
          ${demoMode ? `<div class="hidden items-center gap-1 rounded-xl border border-white/10 bg-white/5 p-1 xl:flex" role="group" aria-label="Demo: view the app as another role">
            <span class="flex items-center gap-1 px-2 text-[0.65rem] font-semibold tracking-wider text-white/45 uppercase">${icon('swap', 'h-3.5 w-3.5')}${t('Preview as')}</span>${demoBtns('rounded-lg px-2.5 py-1 text-xs font-semibold transition')}</div>` : ''}
          <div class="relative">
            <button type="button" id="lang-btn" class="flex items-center gap-1 rounded-xl p-2.5 text-white/80 transition hover:bg-white/10 hover:text-white" aria-haspopup="true" aria-expanded="false" aria-controls="lang-menu" aria-label="${t('Language')}: ${LANGS.find((l) => l.code === getLang()).native}">
              ${icon('globe')}<span class="hidden text-xs font-semibold uppercase sm:inline">${getLang()}</span></button>
            <ul id="lang-menu" role="menu" class="glass-strong pointer-events-none absolute right-0 mt-2 w-56 origin-top-right scale-95 p-1.5 opacity-0 transition duration-200">
              ${LANGS.map((l) => `<li role="none"><button type="button" role="menuitemradio" aria-checked="${l.code === getLang()}" data-lang="${l.code}" lang="${l.code}" class="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition hover:bg-white/10 aria-checked:bg-gradient-to-r aria-checked:from-purple/40 aria-checked:to-salmon/20">${l.native}${l.code === getLang() ? icon('check', 'h-4 w-4') : ''}</button></li>`).join('')}
              <li role="none" class="px-3 pt-2 pb-1 text-[0.65rem] leading-snug text-white/40">${t('More South African languages are coming. Translations are reviewed by native speakers.')}</li>
            </ul>
          </div>
          <button type="button" id="a11y-btn" data-tour="a11y" class="rounded-xl p-2.5 text-white/80 transition hover:bg-white/10 hover:text-white" aria-label="${t('Accessibility settings')} (a)" title="${t('Accessibility settings')}">${icon('accessibility')}</button>
          <button type="button" data-tour="theme" id="theme-toggle" class="rounded-xl p-2.5 text-white/80 transition hover:bg-white/10 hover:text-white" aria-label="${t('Toggle light or dark theme')}">${icon(document.documentElement.dataset.theme === 'light' ? 'moon' : 'sun')}</button>
          <div class="relative">
            <button type="button" id="bell" data-tour="bell" class="relative rounded-xl p-2.5 text-white/80 transition hover:bg-white/10 hover:text-white" aria-label="${t('Notifications')}" aria-expanded="false" aria-controls="notif-panel">
              ${icon('bell')}<span id="bell-count" class="absolute -top-0.5 -right-0.5 hidden h-5 min-w-5 items-center justify-center rounded-full bg-salmon px-1 text-[0.65rem] font-bold text-snow ring-2 ring-night animate-pop"></span>
            </button>
            <div id="notif-panel" class="glass-strong pointer-events-none absolute right-0 mt-2 w-[min(22rem,calc(100vw-2rem))] origin-top-right scale-95 p-2 opacity-0 transition duration-200" role="region" aria-label="${t('Notifications')}"></div>
          </div>
          <a href="/profile" class="hidden sm:block" aria-label="${t('Your profile')}" data-top-avatar>${avatarHtml({ name: user.fullName, avatar: user.avatar, id: user.id }, 'h-10 w-10 text-sm', 'transition hover:scale-105')}</a>
        </div>
        ${demoMode ? `<div class="mt-2 flex items-center justify-center gap-1 xl:hidden" role="group" aria-label="Demo: preview as role">${demoBtns('rounded-lg px-3 py-1 text-xs font-semibold border border-white/10 bg-white/5')}</div>` : ''}
        <div id="banner-slot"></div>
      </header>
      <div id="main-wrap" class="px-4 pt-6 pb-28 sm:px-6"></div>
    </div>`;

  document.body.prepend(...shell.childNodes);
  document.getElementById('main-wrap').append(main);
  main.classList.add('mx-auto', 'max-w-7xl', 'animate-fade-up');
  main.classList.remove('opacity-0');
  if (main.dataset.easy) main.insertAdjacentHTML('afterbegin', `<div class="easy-summary card mb-6 !border-salmon/40" role="note"><p class="flex items-center gap-2 font-semibold">${icon('info', 'h-5 w-5 text-salmon-50')}${t('About this page')}</p><p class="mt-2 text-base leading-relaxed">${t(main.dataset.easy)}</p></div>`);
  translateDom(document);

  wireShell(user);
  loadNotifications();
  loadLevel();
  if (user.role !== 'recruiter') loadBirthdayBanner(user);
  startLive();
  onLive('notify', loadNotifications);
  onLive('xp', loadLevel);
  initVoiceInput();
  initShortcuts(user, {
    home: HOME[user.role],
    palette: ['recruiter', 'facilitator'].includes(user.role) ? () => {} : togglePalette,
    cammy: () => document.getElementById('cammy-toggle')?.click(),
    theme: () => document.getElementById('theme-toggle').click(),
    a11y: () => document.getElementById('a11y-btn').click(),
  });
  document.addEventListener('live:status', (e) => {
    const on = e.detail.connected;
    document.querySelector('[data-live-dot]').className = `h-1.5 w-1.5 rounded-full ${on ? 'bg-ok animate-pulse' : 'bg-white/30'}`;
    document.querySelector('[data-live-text]').textContent = on ? t('Live') : t('Reconnecting');
  });

  const pages = NAV[user.role].flatMap(([, links]) => links.map(([href, label, ic]) => ({ href, label: t(label), icon: ic })));
  const actions = [
    ...(user.role === 'candidate' ? [{ label: t('Raise a new request'), icon: 'plus', href: '/new-request' }] : []),
    { label: t('Design my avatar'), icon: 'palette', href: '/profile#avatar' },
    { label: t('Accessibility settings'), icon: 'accessibility', run: () => document.getElementById('a11y-btn').click() },
    { label: t('Read this page aloud'), icon: 'volume', run: () => import('./a11y.js').then((m) => m.readPage()) },
    { label: t('Keyboard shortcuts'), icon: 'command', run: () => import('./a11y.js').then((m) => m.showShortcuts(user)) },
    { label: t('Take the guided tour'), icon: 'compass', run: () => import('./components/tour.js').then((m) => m.startTour(user, { avatar: user.avatar })) },
    { label: t('Toggle light / dark theme'), icon: 'sun', run: () => document.getElementById('theme-toggle').click() },
    { label: t('Ask Cammy'), icon: 'chat', run: () => document.getElementById('cammy-toggle')?.click() },
    ...LANGS.filter((l) => l.code !== getLang()).map((l) => ({ label: `${t('Language')}: ${l.native}`, icon: 'globe', run: () => setLanguage(l.code) })),
  ];
  initPalette({ user, pages, actions });

  import('./components/cammy.js').then((m) => m.mountCammy(user)).catch((e) => console.error(e));
  const forced = new URLSearchParams(location.search).get('tour') === '1';
  if ((forced || !user.tourDone) && location.pathname === HOME[user.role]) {
    setTimeout(() => import('./components/tour.js').then((m) => m.startTour(user, { avatar: user.avatar })), 1400);
  }
}

function wireShell(user) {
  const sidebar = document.getElementById('sidebar');
  const scrim = document.getElementById('drawer-scrim');
  const opener = document.getElementById('open-drawer');
  const setDrawer = (open) => {
    sidebar.classList.toggle('-translate-x-[110%]', !open);
    scrim.classList.toggle('opacity-0', !open);
    scrim.classList.toggle('pointer-events-none', !open);
    opener.setAttribute('aria-expanded', String(open));
  };
  opener.addEventListener('click', () => setDrawer(true));
  scrim.addEventListener('click', () => setDrawer(false));
  document.querySelector('[data-close-drawer]').addEventListener('click', () => setDrawer(false));

  document.querySelectorAll('[data-logout]').forEach((b) => b.addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST' });
    location.href = '/';
  }));
  document.querySelectorAll('[data-open-palette]').forEach((b) => b.addEventListener('click', togglePalette));

  document.querySelectorAll('[data-demo-role]').forEach((b) => b.addEventListener('click', async () => {
    if (b.dataset.demoRole === user.role) return;
    const { user: u } = await api('/auth/demo-login', { method: 'POST', body: { role: b.dataset.demoRole } });
    leaveTo(HOME[u.role]);
  }));

  const langBtn = document.getElementById('lang-btn');
  const langMenu = document.getElementById('lang-menu');
  const setLangMenu = (open) => {
    langMenu.classList.toggle('opacity-0', !open); langMenu.classList.toggle('scale-95', !open); langMenu.classList.toggle('pointer-events-none', !open);
    langBtn.setAttribute('aria-expanded', String(open));
    if (open) langMenu.querySelector('[aria-checked="true"]')?.focus();
  };
  langBtn.addEventListener('click', (e) => { e.stopPropagation(); setLangMenu(langBtn.getAttribute('aria-expanded') !== 'true'); });
  langMenu.addEventListener('click', (e) => { const b = e.target.closest('[data-lang]'); if (b && b.dataset.lang !== getLang()) setLanguage(b.dataset.lang); });
  langMenu.addEventListener('keydown', (e) => {
    const items = [...langMenu.querySelectorAll('[data-lang]')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    if (e.key === 'Escape') { setLangMenu(false); langBtn.focus(); }
  });
  document.addEventListener('click', (e) => { if (!langMenu.contains(e.target)) setLangMenu(false); });

  let prefTimer;
  document.getElementById('a11y-btn').addEventListener('click', () => openA11yPanel(user.preferences || {}, (patch) => {
    user.preferences = { ...(user.preferences || {}), ...patch };
    applyPreferences(user.preferences);
    document.getElementById('theme-toggle').innerHTML = icon(document.documentElement.dataset.theme === 'light' ? 'moon' : 'sun');
    clearTimeout(prefTimer);
    prefTimer = setTimeout(() => api('/profile/preferences', { method: 'PATCH', body: patch }).catch(() => {}), 300);
    announce(t('Setting saved'));
  }));

  document.getElementById('theme-toggle').addEventListener('click', async (e) => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    const prefs = { ...(user.preferences || {}), theme: next };
    user.preferences = prefs;
    applyPreferences(prefs);
    e.currentTarget.innerHTML = icon(next === 'light' ? 'moon' : 'sun');
    document.querySelectorAll('img[src*="logo-full"]').forEach((img) => { img.src = `/assets/${next === 'light' ? 'logo-full' : 'logo-full-light'}.png`; });
    api('/profile/preferences', { method: 'PATCH', body: { theme: next } }).catch(() => {});
  });

  // Notifications dropdown
  const bell = document.getElementById('bell');
  const panel = document.getElementById('notif-panel');
  const setPanel = (open) => {
    panel.classList.toggle('opacity-0', !open);
    panel.classList.toggle('scale-95', !open);
    panel.classList.toggle('pointer-events-none', !open);
    bell.setAttribute('aria-expanded', String(open));
  };
  bell.addEventListener('click', (e) => { e.stopPropagation(); setPanel(bell.getAttribute('aria-expanded') !== 'true'); });
  document.addEventListener('click', (e) => { if (!panel.contains(e.target)) setPanel(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { setPanel(false); setDrawer(false); } });

  // Live clock in the top bar subtitle
  const clock = document.querySelector('[data-clock]');
  const base = clock.textContent;
  const fmt = new Intl.DateTimeFormat([LANGS.find((l) => l.code === getLang()).speech, 'en-ZA'], { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  const tick = () => { clock.textContent = `${base ? `${base} · ` : ''}${fmt.format(new Date())}`; };
  tick();
  setInterval(tick, 30_000);

  // Smooth page transitions for internal links
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="/"]');
    if (!a || a.target || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0 || a.hasAttribute('download')) return;
    const href = a.getAttribute('href');
    if (href.startsWith('/api/')) return;
    if (href.split('#')[0] === location.pathname && href.includes('#')) return; // same-page anchor
    e.preventDefault();
    leaveTo(href);
  });
}

export function leaveTo(href) {
  if (reduceMotion()) { location.href = href; return; }
  document.body.classList.add('page-leave');
  setTimeout(() => { location.href = href; }, 170);
}

async function loadLevel() {
  try {
    const g = await api('/me/progress');
    document.querySelector('[data-level-label]').textContent = t('Level {level}', { level: g.level });
    document.querySelector('[data-xp-label]').textContent = `${g.xp} XP`;
    requestAnimationFrame(() => { document.querySelector('[data-level-bar]').style.width = `${(g.levelProgress / g.levelSize) * 100}%`; });
  } catch { /* non-critical */ }
}

const TONE = {
  celebrate: ['bg-gradient-to-br from-salmon to-purple text-snow', 'cake'],
  warn: ['bg-warn/15 text-warn', 'hourglass'],
  ok: ['bg-ok/15 text-ok', 'check'],
  info: ['bg-purple/25 text-purple-30', 'info'],
};

async function loadNotifications() {
  try {
    const { items } = await api('/notifications');
    const count = document.getElementById('bell-count');
    const prev = Number(count.textContent || 0);
    count.textContent = items.length;
    count.classList.toggle('hidden', !items.length);
    count.classList.toggle('flex', !!items.length);
    if (items.length > prev && prev) announce(t('You have {n} new notifications', { n: items.length - prev }));
    if (items.length > prev && prev) document.getElementById('bell').animate([{ transform: 'rotate(0)' }, { transform: 'rotate(-14deg)' }, { transform: 'rotate(12deg)' }, { transform: 'rotate(0)' }], { duration: 500 });
    document.getElementById('notif-panel').innerHTML = `
      <p class="px-3 pt-2 pb-1 text-xs font-semibold tracking-wider text-white/50 uppercase">${t('Notifications')}</p>
      ${items.length ? `<ul class="max-h-96 overflow-y-auto">${items.map((n) => {
        const [tone, ic] = TONE[n.tone] || TONE.info;
        const inner = `<span class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${tone}">${icon(ic, 'h-4 w-4')}</span>
          <span class="min-w-0"><span class="block text-sm font-semibold">${esc(n.tkey ? t(n.tkey, n.vars) : n.title)}</span><span class="block truncate text-xs text-white/55">${esc(n.bkey ? t(n.bkey, n.vars) : n.body || '')}</span></span>`;
        return `<li>${n.href ? `<a href="${esc(n.href)}" class="flex gap-3 rounded-xl p-3 transition hover:bg-white/[0.07]">${inner}</a>` : `<div class="flex gap-3 p-3">${inner}</div>`}</li>`;
      }).join('')}</ul>` : `<p class="px-3 py-6 text-center text-sm text-white/50">${t("You're all caught up.")}</p>`}`;
  } catch { /* non-critical */ }
}

async function loadBirthdayBanner(user) {
  try {
    const { today } = await api('/people/birthdays');
    const others = today.filter((b) => b.id !== user.id && b.role === 'candidate');
    const self = today.find((b) => b.id === user.id);
    const key = `bday-dismiss-${new Date().toDateString()}`;
    if ((!others.length && !self) || localStorage.getItem(key)) return;

    const colours = ['#f25251', '#6115d0', '#f1d1d1', '#b08ae7', '#f8a8a8', '#fbbf24'];
    const confetti = Array.from({ length: 26 }, (_, i) =>
      `<i style="left:${(i * 37) % 100}%;background:${colours[i % colours.length]};animation-duration:${2.4 + (i % 5) * 0.5}s;animation-delay:${(i % 7) * 0.35}s"></i>`).join('');
    const text = self
      ? `<strong>${t('Happy birthday, {name}!', { name: esc(self.firstName) })}</strong> ${t('Everyone at CAPACITI is celebrating you today.')}`
      : `${t('Today we are celebrating {names}.', { names: `<strong>${others.map((o) => esc(o.name)).join(', ')}</strong>` })}${others[0].cohort ? ` <span class="opacity-80">· ${esc(others[0].cohort)}</span>` : ''}&nbsp; ${t('Wish them a happy birthday!')}`;

    document.getElementById('banner-slot').innerHTML = `
      <div class="confetti relative mt-3 overflow-hidden rounded-2xl border border-white/15 bg-gradient-to-r from-purple/80 via-salmon/70 to-purple/80 bg-[length:200%_auto] px-4 py-3 text-snow shadow-lg animate-gradient animate-pop" role="status">
        ${confetti}
        <div class="relative flex items-center gap-3">
          <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-snow/20">${icon('cake', 'h-5 w-5')}</span>
          <div class="hidden -space-x-2 sm:flex">${(self ? [self] : others).slice(0, 3).map((o) => avatarHtml({ name: o.name, avatar: o.avatar, id: o.id }, 'h-9 w-9 text-xs', 'animate-float')).join('')}</div>
          <p class="flex-1 text-sm">${text}</p>
          <button type="button" class="rounded-lg p-1.5 hover:bg-snow/15" aria-label="${t('Dismiss birthday banner')}" data-dismiss>${icon('close', 'h-4 w-4')}</button>
        </div>
      </div>`;
    document.querySelector('[data-dismiss]').addEventListener('click', (e) => {
      localStorage.setItem(key, '1');
      e.target.closest('.confetti').remove();
    });
  } catch { /* non-critical */ }
}
