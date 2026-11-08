// Cammy — the CAPACITI assistant. She wears the signed-in user's avatar and moves
// between states: idle · listening · thinking · talking · celebrating · concerned · sleeping.
import { api } from '../api.js';
import { esc, miniMd, reduceMotion, toast } from '../ui.js';
import { icon } from '../icons.js';
import { renderAvatar, setAvatarState } from './avatar.js';
import { startTour } from './tour.js';
import { toggle as togglePalette } from './palette.js';
import { t } from '../i18n.js';
import { speak, canSpeak, shouldAutoRead } from '../a11y.js';

const STATE_LABEL = {
  idle: 'Online', listening: 'Listening…', thinking: 'Thinking…', talking: 'Typing a reply…',
  celebrating: 'Celebrating with you', concerned: 'Here for you', sleeping: 'Resting. Say hi to wake me',
};

export function mountCammy(user) {
  if (document.getElementById('cammy-root')) return;
  let avatar = user.avatar;
  const root = document.createElement('div');
  root.id = 'cammy-root';
  root.innerHTML = `
    <div id="cammy-bubble" class="pointer-events-none fixed right-20 bottom-7 z-[60] max-w-[15rem] translate-y-2 rounded-2xl rounded-br-sm border border-white/10 bg-night/95 px-3.5 py-2.5 text-sm text-white opacity-0 shadow-2xl backdrop-blur-xl transition duration-400 sm:right-24 sm:bottom-9"></div>

    <button type="button" id="cammy-toggle" data-tour="cammy"
      class="group fixed right-4 bottom-4 z-[60] h-14 w-14 rounded-full transition duration-300 hover:scale-110 focus-visible:outline-offset-4 sm:right-6 sm:bottom-6"
      aria-label="Chat with Cammy, the CAPACITI assistant" aria-expanded="false" aria-controls="cammy-panel">
      <span class="absolute -inset-1 rounded-full bg-gradient-to-br from-purple to-salmon opacity-50 blur-md transition group-hover:opacity-90"></span>
      <span class="relative block h-full w-full overflow-hidden rounded-full border-2 border-white/40 bg-night shadow-xl" data-launcher-avatar></span>
      <span class="absolute right-0 bottom-0 h-3.5 w-3.5 rounded-full border-2 border-night bg-ok" data-dot></span>
    </button>

    <section id="cammy-panel" role="dialog" aria-label="Chat with Cammy" aria-modal="false"
      class="glass-strong fixed right-3 bottom-24 z-[60] flex h-[min(34rem,calc(100dvh-8rem))] w-[min(23rem,calc(100vw-1.5rem))] origin-bottom-right scale-90 flex-col overflow-hidden opacity-0 transition duration-300 pointer-events-none sm:right-6">
      <header class="relative flex items-center gap-3 border-b border-white/10 bg-gradient-to-r from-purple/40 to-salmon/30 px-4 py-3">
        <span class="h-12 w-12 shrink-0 overflow-hidden rounded-2xl ring-2 ring-white/25" data-panel-avatar></span>
        <div class="min-w-0 flex-1">
          <p class="font-display font-semibold">Cammy</p>
          <p class="flex items-center gap-1.5 truncate text-xs text-white/75"><span class="h-2 w-2 shrink-0 rounded-full bg-ok" data-pdot></span><span data-state-label>Online</span></p>
        </div>
        <a href="/profile#avatar" class="rounded-xl p-2 text-white/80 hover:bg-white/15" title="Change Cammy's look (your avatar)" aria-label="Change Cammy's look">${icon('palette', 'h-5 w-5')}</a>
        <button type="button" data-close class="rounded-xl p-2 text-white/80 hover:bg-white/15" aria-label="Close chat">${icon('close', 'h-5 w-5')}</button>
      </header>
      <ol id="cammy-log" class="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite"></ol>
      <div id="cammy-suggest" class="flex gap-2 overflow-x-auto px-4 pb-2 [scrollbar-width:none]"></div>
      <form id="cammy-form" class="flex items-center gap-2 border-t border-white/10 p-3">
        <label for="cammy-input" class="sr-only">Message Cammy</label>
        <input id="cammy-input" data-voice autocomplete="off" maxlength="500" placeholder="Ask Cammy anything…" class="field !rounded-full">
        <button class="btn btn-primary !rounded-full !p-2.5" aria-label="Send">${icon('send', 'h-5 w-5')}</button>
      </form>
    </section>`;
  document.body.append(root);

  const $ = (s) => root.querySelector(s);
  const toggleBtn = $('#cammy-toggle');
  const panel = $('#cammy-panel');
  const log = $('#cammy-log');
  const input = $('#cammy-input');
  const bubble = $('#cammy-bubble');
  let state = 'idle';
  let started = false;
  let revertTimer;
  let sleepTimer;

  const paint = () => {
    $('[data-launcher-avatar]').innerHTML = renderAvatar(avatar, { crop: 'head', state, label: 'Cammy', live: true });
    $('[data-panel-avatar]').innerHTML = renderAvatar(avatar, { crop: 'head', state, label: 'Cammy', live: true });
  };

  function setState(next, ms) {
    clearTimeout(revertTimer);
    state = next;
    root.querySelectorAll('.av-live').forEach((el) => setAvatarState(el, next));
    $('[data-state-label]').textContent = t(STATE_LABEL[next]);
    const dot = next === 'sleeping' ? 'bg-white/40' : next === 'concerned' ? 'bg-warn' : 'bg-ok';
    for (const d of root.querySelectorAll('[data-dot],[data-pdot]')) d.className = d.className.replace(/bg-\S+/, dot);
    if (ms) revertTimer = setTimeout(() => setState('idle'), ms);
  }

  // Sleep after a while with no activity; wake on any interaction.
  const wake = () => {
    if (state === 'sleeping') setState('idle');
    clearTimeout(sleepTimer);
    sleepTimer = setTimeout(() => { if (toggleBtn.getAttribute('aria-expanded') !== 'true') setState('sleeping'); }, 90_000);
  };
  ['pointermove', 'keydown', 'scroll'].forEach((ev) => addEventListener(ev, wake, { passive: true }));

  function say(text, nextState = 'talking', ms = 3200) {
    bubble.textContent = text;
    bubble.classList.remove('opacity-0', 'translate-y-2');
    setState(nextState, ms);
    setTimeout(() => bubble.classList.add('opacity-0', 'translate-y-2'), ms + 400);
  }

  const setOpen = (open) => {
    panel.classList.toggle('opacity-0', !open);
    panel.classList.toggle('scale-90', !open);
    panel.classList.toggle('pointer-events-none', !open);
    toggleBtn.setAttribute('aria-expanded', String(open));
    bubble.classList.add('opacity-0', 'translate-y-2');
    if (open) {
      wake();
      if (!started) { started = true; send('', { silent: true }); }
      setTimeout(() => input.focus(), 200);
    } else setState('idle');
  };
  toggleBtn.addEventListener('click', () => setOpen(toggleBtn.getAttribute('aria-expanded') !== 'true'));
  toggleBtn.addEventListener('mouseenter', () => { if (state === 'idle') setState('listening', 1500); });
  $('[data-close]').addEventListener('click', () => { setOpen(false); toggleBtn.focus(); });
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { setOpen(false); toggleBtn.focus(); } });
  input.addEventListener('input', () => { if (state !== 'thinking') setState(input.value ? 'listening' : 'idle'); });

  const scroll = () => log.scrollTo({ top: log.scrollHeight, behavior: reduceMotion() ? 'auto' : 'smooth' });
  const mini = () => `<span class="h-8 w-8 shrink-0 overflow-hidden rounded-full ring-1 ring-white/20">${renderAvatar(avatar, { crop: 'head', animated: false, label: 'Cammy' })}</span>`;

  function addUser(text) {
    log.insertAdjacentHTML('beforeend', `<li class="flex justify-end animate-pop"><p class="max-w-[85%] rounded-2xl rounded-br-sm bg-gradient-to-r from-purple to-purple-80 px-3.5 py-2 text-sm text-snow shadow">${esc(text)}</p></li>`);
    scroll();
  }
  const plain = (md) => md.replace(/\*\*/g, '').replace(/•/g, '');
  function addBot(res) {
    if (canSpeak() && shouldAutoRead()) speak(plain(res.reply));
    log.insertAdjacentHTML('beforeend', `
      <li class="flex items-end gap-2 animate-pop">${mini()}
        <div class="max-w-[85%] space-y-2">
          <p class="rounded-2xl rounded-bl-sm border border-white/10 bg-white/[0.07] px-3.5 py-2.5 text-sm leading-relaxed text-white/85">${miniMd(res.reply)}</p>
          ${canSpeak() ? `<button type="button" class="chip !py-0.5" data-speak="${esc(plain(res.reply))}">${icon('volume', 'h-3.5 w-3.5')}${t('Listen')}</button>` : ''}
          ${res.actions?.length ? `<div class="flex flex-wrap gap-1.5">${res.actions.map((a) => `<a href="${esc(a.href)}" class="chip !border-salmon/40 !bg-salmon/15 !text-salmon-50 hover:!bg-salmon/30">${esc(a.label)}${icon('arrowRight', 'h-3 w-3')}</a>`).join('')}</div>` : ''}
        </div>
      </li>`);
    $('#cammy-suggest').innerHTML = (res.suggestions || []).map((x) => `<button type="button" class="chip shrink-0" data-q="${esc(x.q || x)}">${esc(x.label || x)}</button>`).join('');
    scroll();
  }

  async function send(text, { silent = false, display } = {}) {
    if (!silent) addUser(display || text);
    setState('thinking');
    const typing = document.createElement('li');
    typing.className = 'flex items-center gap-2';
    typing.innerHTML = `${mini()}<span class="typing flex gap-1 rounded-2xl border border-white/10 bg-white/[0.07] px-3 py-3" aria-label="Cammy is typing"><span class="h-1.5 w-1.5 rounded-full bg-white"></span><span class="h-1.5 w-1.5 rounded-full bg-white"></span><span class="h-1.5 w-1.5 rounded-full bg-white"></span></span>`;
    log.append(typing);
    scroll();
    try {
      const [res] = await Promise.all([api('/cammy/chat', { method: 'POST', body: { message: text } }), new Promise((r) => setTimeout(r, reduceMotion() ? 0 : 700))]);
      typing.remove();
      addBot(res);
      const talkMs = Math.min(4000, Math.max(1200, res.reply.length * 25));
      if (res.mood === 'celebrate') setState('celebrating', 2600);
      else if (res.mood === 'concerned') setState('concerned');
      else setState('talking', talkMs);
      if (res.command?.type === 'tour') setTimeout(() => { setOpen(false); startTour(user, { avatar }); }, 900);
      if (res.command?.type === 'palette') setTimeout(() => { setOpen(false); togglePalette(); }, 700);
    } catch {
      typing.remove();
      addBot({ reply: t("I couldn't reach the server. Please try again in a moment."), actions: [] });
      setState('concerned', 3000);
    }
  }

  $('#cammy-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    send(text);
  });
  $('#cammy-suggest').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) send(b.dataset.q, { display: b.textContent }); });
  log.addEventListener('click', (e) => {
    const sp = e.target.closest('[data-speak]');
    if (sp) speak(sp.dataset.speak);
    const a = e.target.closest('a[href="#a11y"]');
    if (a) { e.preventDefault(); setOpen(false); document.getElementById('a11y-btn')?.click(); }
  });

  // Celebrate badges from anywhere in the app (tour finish, live XP events, API responses)
  const seen = new Set();
  const celebrate = (badges = []) => {
    badges = (badges || []).filter((b) => !seen.has(b.key) && seen.add(b.key));
    if (!badges.length) return;
    for (const b of badges) toast(`${t('Badge unlocked')}: ${t(b.name)}. ${t(b.description)}`, 'success');
    say(t('You earned the {badge} badge!', { badge: t(badges[0].name) }), 'celebrating', 3000);
  };
  document.addEventListener('cammy:badges', (e) => celebrate(e.detail));
  document.addEventListener('live:xp', (e) => celebrate(e.detail?.badges));
  document.addEventListener('cammy:say', (e) => say(e.detail.text, e.detail.state || 'talking'));
  document.addEventListener('cammy:avatar', (e) => { avatar = e.detail; paint(); setState('celebrating', 2400); });

  paint();
  wake();
  if (!sessionStorage.getItem('cammy-greeted') && user.tourDone) {
    sessionStorage.setItem('cammy-greeted', '1');
    setTimeout(() => { if (toggleBtn.getAttribute('aria-expanded') !== 'true') say(t("Hi {name}, I'm here if you need me.", { name: user.firstName }), 'talking', 2800); }, 2200);
  }
  return { say, setState, celebrate };
}
