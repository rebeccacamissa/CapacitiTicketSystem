// Accessibility toolkit: display preferences, reading guide, read-aloud (text-to-speech),
// voice input (speech-to-text), keyboard shortcuts, screen-reader announcements and the
// Accessibility panel. Everything is opt-in and saved per user.
import { t, langInfo, translateDom } from './i18n.js';
import { icon } from './icons.js';

const FONTS = {
  lexend: 'https://fonts.googleapis.com/css2?family=Lexend:wght@400;500;600;700&display=swap',
  atkinson: 'https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&display=swap',
};

// ---------------------------------------------------------------------------
// Display preferences → <html data-*> attributes (styled in tailwind.css)
// ---------------------------------------------------------------------------
export function applyA11y(p = {}) {
  const root = document.documentElement;
  const set = (k, on, val = '1') => { if (on) root.dataset[k] = val; else delete root.dataset[k]; };
  set('text', p.textSize && p.textSize !== 'normal', p.textSize);
  set('font', p.font && p.font !== 'default', p.font);
  set('spacing', !!p.spacing);
  set('cb', !!p.cbSafe);
  set('targets', !!p.largeTargets);
  set('easy', !!p.easyRead);
  set('motion', !!p.reduceMotion, 'reduce');
  if (p.font && FONTS[p.font] && !document.querySelector(`link[data-font="${p.font}"]`)) {
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = FONTS[p.font]; l.dataset.font = p.font;
    document.head.append(l);
  }
  readingGuide(!!p.readingGuide);
  speechRate = Number(p.speechRate || 1);
  autoRead = !!p.autoRead;
}

// ---------------------------------------------------------------------------
// Screen-reader announcements
// ---------------------------------------------------------------------------
let polite, assertive;
export function announce(msg, urgent = false) {
  if (!polite) {
    polite = Object.assign(document.createElement('div'), { className: 'sr-only' });
    polite.setAttribute('aria-live', 'polite');
    assertive = Object.assign(document.createElement('div'), { className: 'sr-only' });
    assertive.setAttribute('aria-live', 'assertive');
    document.body.append(polite, assertive);
  }
  const el = urgent ? assertive : polite;
  el.textContent = '';
  setTimeout(() => { el.textContent = msg; }, 60);
}

// ---------------------------------------------------------------------------
// Reading guide: a clear band that follows the pointer / focus, dimming the rest
// ---------------------------------------------------------------------------
let guide = null;
function readingGuide(on) {
  if (!on) { guide?.remove(); guide = null; return; }
  if (guide) return;
  guide = document.createElement('div');
  guide.setAttribute('aria-hidden', 'true');
  guide.innerHTML = '<div class="rg-top"></div><div class="rg-band"></div><div class="rg-bottom"></div>';
  guide.className = 'reading-guide';
  document.body.append(guide);
  const move = (y) => guide.style.setProperty('--rg-y', `${y}px`);
  addEventListener('pointermove', (e) => move(e.clientY), { passive: true });
  addEventListener('focusin', (e) => { const r = e.target.getBoundingClientRect?.(); if (r) move(r.top + r.height / 2); });
  move(innerHeight / 3);
}

// ---------------------------------------------------------------------------
// Read aloud (browser text-to-speech)
// ---------------------------------------------------------------------------
let speechRate = 1;
let autoRead = false;
export const shouldAutoRead = () => autoRead;
export const canSpeak = () => 'speechSynthesis' in window;
let warnedVoice = false;

function pickVoice() {
  const want = langInfo().speech.toLowerCase();
  const voices = speechSynthesis.getVoices();
  return voices.find((v) => v.lang.toLowerCase() === want)
    || voices.find((v) => v.lang.toLowerCase().startsWith(want.split('-')[0]))
    || voices.find((v) => v.lang.toLowerCase() === 'en-za')
    || voices.find((v) => v.lang.toLowerCase().startsWith('en'));
}

export function speak(text, { onEnd } = {}) {
  if (!canSpeak() || !text?.trim()) return;
  speechSynthesis.cancel();
  const voice = pickVoice();
  if (voice && !voice.lang.toLowerCase().startsWith(langInfo().speech.split('-')[0].toLowerCase()) && !warnedVoice) {
    warnedVoice = true;
    import('./ui.js').then((m) => m.toast(t('No {lang} voice is installed on this device, so an English voice will read instead.', { lang: langInfo().native }), 'info'));
  }
  // Chrome stops long utterances, so speak sentence by sentence.
  const chunks = text.replace(/\s+/g, ' ').match(/[^.!?]+[.!?]*/g) || [text];
  chunks.forEach((c, i) => {
    const u = new SpeechSynthesisUtterance(c.trim());
    if (voice) u.voice = voice;
    u.lang = voice?.lang || langInfo().speech;
    u.rate = speechRate;
    if (i === chunks.length - 1) u.onend = () => { speakingUi(false); onEnd?.(); };
    speechSynthesis.speak(u);
  });
  speakingUi(true);
}
export function stopSpeaking() { if (canSpeak()) speechSynthesis.cancel(); speakingUi(false); }

export function readPage() {
  const main = document.getElementById('main');
  if (!main) return;
  const clone = main.cloneNode(true);
  clone.querySelectorAll('[aria-hidden="true"], .sr-only, script, style, svg, [hidden]').forEach((n) => n.remove());
  speak(`${document.querySelector('header h1')?.textContent || ''}. ${clone.innerText}`);
}

let speakBar;
function speakingUi(on) {
  if (!on) { speakBar?.remove(); speakBar = null; return; }
  if (speakBar) return;
  speakBar = document.createElement('div');
  speakBar.className = 'glass-strong fixed bottom-24 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-3 !rounded-full px-4 py-2 text-sm animate-pop';
  speakBar.setAttribute('role', 'status');
  speakBar.innerHTML = `<span class="flex gap-0.5" aria-hidden="true">${[0, 1, 2, 3].map((i) => `<span class="h-3 w-1 rounded-full bg-salmon animate-pulse" style="animation-delay:${i * 0.15}s"></span>`).join('')}</span>
    <span>${t('Reading aloud…')}</span><button type="button" class="btn btn-ghost btn-sm">${t('Stop')}</button>`;
  speakBar.querySelector('button').addEventListener('click', stopSpeaking);
  document.body.append(speakBar);
}

// ---------------------------------------------------------------------------
// Voice input (speech-to-text) — adds a mic button to any [data-voice] field
// ---------------------------------------------------------------------------
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canListen = () => !!Recognition;

function attachMic(field) {
  if (field.dataset.micReady) return;
  field.dataset.micReady = '1';
  if (!Recognition) return;
  const wrap = field.parentElement;
  wrap.classList.add('relative');
  field.classList.add('!pr-11');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mic-btn absolute right-2 top-2 rounded-lg p-1.5 text-white/60 transition hover:bg-white/10 hover:text-white aria-pressed:bg-salmon aria-pressed:text-snow';
  btn.setAttribute('aria-pressed', 'false');
  btn.setAttribute('aria-label', t('Dictate with your voice'));
  btn.title = t('Dictate with your voice');
  btn.innerHTML = icon('mic', 'h-4 w-4');
  field.after(btn);
  let rec = null;
  btn.addEventListener('click', () => {
    if (rec) { rec.stop(); return; }
    rec = new Recognition();
    rec.lang = langInfo().speech;
    rec.interimResults = true;
    rec.continuous = true;
    const base = field.value ? `${field.value.trim()} ` : '';
    rec.onresult = (e) => {
      let text = '';
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      field.value = base + text;
      field.dispatchEvent(new Event('input', { bubbles: true }));
    };
    rec.onerror = (e) => {
      if (e.error === 'language-not-supported') import('./ui.js').then((m) => m.toast(t('Voice input is not available in this language on this browser. Try English.'), 'error'));
    };
    rec.onend = () => { rec = null; btn.setAttribute('aria-pressed', 'false'); announce(t('Stopped listening')); };
    rec.start();
    btn.setAttribute('aria-pressed', 'true');
    announce(t('Listening. Speak now.'));
  });
}
export function initVoiceInput() {
  const scan = () => document.querySelectorAll('[data-voice]').forEach(attachMic);
  scan();
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts (ignored while typing)
// ---------------------------------------------------------------------------
export function initShortcuts(user, actions) {
  let pendingG = 0;
  const typing = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  const go = { d: actions.home, r: '/requests', f: '/feed', p: '/profile', c: '/candidates', a: '/admin', i: '/insights' };
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target) || document.querySelector('dialog[open]')) return;
    const k = e.key.toLowerCase();
    if (Date.now() - pendingG < 1200 && go[k]) { e.preventDefault(); pendingG = 0; location.href = go[k]; return; }
    if (k === 'g') { pendingG = Date.now(); return; }
    if (e.key === '?') { e.preventDefault(); showShortcuts(user); }
    else if (k === '/') { e.preventDefault(); actions.palette(); }
    else if (k === 'n' && user.role === 'candidate') location.href = '/new-request';
    else if (k === 'm') { e.preventDefault(); actions.cammy(); }
    else if (k === 't') actions.theme();
    else if (k === 'a') { e.preventDefault(); actions.a11y(); }
    else if (k === 'l') { e.preventDefault(); readPage(); }
    else if (k === 's') stopSpeaking();
  });
}

export function showShortcuts(user) {
  const rows = [
    ['?', 'Show this help'], ['Ctrl + K  or  /', 'Search and quick actions'], ['g then d', 'Go to my dashboard'], ['g then r', 'Go to requests'],
    ['g then f', 'Go to the cohort feed'], ['g then p', 'Go to my profile'],
    ...(user.role !== 'candidate' ? [['g then c', 'Go to candidates']] : [['n', 'New request']]),
    ['m', 'Open Cammy'], ['a', 'Accessibility settings'], ['t', 'Switch light or dark theme'], ['l', 'Read this page aloud'], ['s', 'Stop reading'], ['Esc', 'Close a panel or dialog'],
  ];
  import('./ui.js').then(({ openModal }) => openModal(`
    <div class="p-6">
      <h2 class="text-xl">${t('Keyboard shortcuts')}</h2>
      <p class="mt-1 text-sm text-white/60">${t('Shortcuts work anywhere except while you are typing in a field.')}</p>
      <dl class="mt-4 divide-y divide-white/10">${rows.map(([k, d]) => `<div class="flex items-center justify-between gap-4 py-2"><dt class="text-sm">${t(d)}</dt><dd><kbd class="rounded-md border border-white/20 bg-white/5 px-2 py-0.5 font-mono text-xs">${k}</kbd></dd></div>`).join('')}</dl>
      <button type="button" class="btn btn-primary mt-5 w-full" data-close>${t('Close')}</button>
    </div>`));
}

// ---------------------------------------------------------------------------
// Accessibility panel
// ---------------------------------------------------------------------------
export function openA11yPanel(prefs, onChange) {
  import('./ui.js').then(({ openModal }) => {
    const seg = (name, value, options) => `<div class="grid gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] p-1" style="grid-template-columns:repeat(${options.length},minmax(0,1fr))" role="radiogroup">
      ${options.map(([v, label]) => `<label class="cursor-pointer rounded-lg px-2 py-2 text-center text-xs font-semibold text-white/65 transition has-[:checked]:bg-gradient-to-r has-[:checked]:from-purple has-[:checked]:to-salmon has-[:checked]:text-snow has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-white">
        <input type="radio" class="sr-only" name="${name}" value="${v}" ${String(value) === String(v) ? 'checked' : ''}>${t(label)}</label>`).join('')}</div>`;
    const toggle = (name, title, desc) => `<label class="flex cursor-pointer items-center justify-between gap-4 rounded-xl bg-white/[0.04] px-4 py-3">
      <span><span class="block text-sm font-medium">${t(title)}</span><span class="block text-xs text-white/55">${t(desc)}</span></span>
      <input type="checkbox" name="${name}" class="peer sr-only" ${prefs[name] ? 'checked' : ''}>
      <span class="relative h-6 w-11 shrink-0 rounded-full bg-white/20 transition peer-checked:bg-salmon peer-focus-visible:ring-2 peer-focus-visible:ring-white after:absolute after:top-0.5 after:left-0.5 after:h-5 after:w-5 after:rounded-full after:bg-snow after:transition peer-checked:after:translate-x-5"></span></label>`;
    const m = openModal(`
      <form class="max-h-[85vh] overflow-y-auto p-6" data-a11y-form>
        <div class="flex items-start justify-between gap-3">
          <div><h2 class="flex items-center gap-2 text-xl">${icon('accessibility', 'h-6 w-6')}${t('Accessibility')}</h2>
          <p class="mt-1 text-sm text-white/60">${t('Changes apply instantly and are saved to your account.')}</p></div>
          <button type="button" data-close class="rounded-xl p-2 text-white/70 hover:bg-white/10" aria-label="${t('Close')}">${icon('close')}</button>
        </div>

        <h3 class="mt-6 mb-2 text-xs font-semibold tracking-[0.15em] text-white/50 uppercase">${t('Seeing & reading')}</h3>
        <div class="space-y-3">
          <div><p class="field-label">${t('Theme')}</p>${seg('theme', prefs.theme || 'dark', [['dark', 'Dark'], ['light', 'Light'], ['contrast', 'High contrast'], ['system', 'System']])}</div>
          <div><p class="field-label">${t('Text size')}</p>${seg('textSize', prefs.textSize || 'normal', [['normal', 'Default'], ['large', 'Large'], ['larger', 'Larger'], ['largest', 'Largest']])}</div>
          <div><p class="field-label">${t('Font')}</p>${seg('font', prefs.font || 'default', [['default', 'Default'], ['lexend', 'Easy reading'], ['atkinson', 'Low vision']])}</div>
          ${toggle('spacing', 'Extra spacing', 'More space between lines, letters and words')}
          ${toggle('cbSafe', 'Colour-blind safe colours', 'Uses blue and orange for status colours')}
          ${toggle('readingGuide', 'Reading guide', 'Highlights the line you are reading and dims the rest')}
        </div>

        <h3 class="mt-6 mb-2 text-xs font-semibold tracking-[0.15em] text-white/50 uppercase">${t('Movement & layout')}</h3>
        <div class="space-y-3">
          ${toggle('reduceMotion', 'Reduce motion', 'Turns off animations and moving backgrounds')}
          ${toggle('largeTargets', 'Larger buttons', 'Makes buttons and links bigger and easier to press')}
          ${toggle('easyRead', 'Easy-read mode', 'Simpler pages with less on screen and a short guide at the top')}
        </div>

        <h3 class="mt-6 mb-2 text-xs font-semibold tracking-[0.15em] text-white/50 uppercase">${t('Listening & speaking')}</h3>
        <div class="space-y-3">
          ${canSpeak() ? `<button type="button" class="btn btn-ghost w-full" data-read>${icon('volume', 'h-4 w-4')}${t('Read this page aloud')}</button>
          ${toggle('autoRead', "Read Cammy's replies aloud", 'Cammy speaks each answer automatically')}
          <div><p class="field-label">${t('Reading speed')}</p>${seg('speechRate', prefs.speechRate || '1', [['0.75', 'Slow'], ['1', 'Normal'], ['1.25', 'Fast'], ['1.5', 'Faster']])}</div>`
            : `<p class="text-sm text-white/55">${t('Read aloud is not supported in this browser.')}</p>`}
          <p class="rounded-xl bg-white/[0.04] p-3 text-xs text-white/60">${icon('mic', 'inline h-4 w-4 align-text-bottom')} ${canListen() ? t('Voice input: press the microphone in any message box to dictate.') : t('Voice input needs Chrome or Edge.')}</p>
        </div>

        <h3 class="mt-6 mb-2 text-xs font-semibold tracking-[0.15em] text-white/50 uppercase">${t('Keyboard & support')}</h3>
        <div class="grid gap-2 sm:grid-cols-2">
          <button type="button" class="btn btn-ghost" data-shortcuts>${icon('command', 'h-4 w-4')}${t('Keyboard shortcuts')}</button>
          <a href="/profile#access-needs" class="btn btn-ghost">${icon('heart', 'h-4 w-4')}${t('My accessibility needs')}</a>
        </div>
      </form>`, { wide: true });
    const form = m.el.querySelector('[data-a11y-form]');
    form.addEventListener('change', (e) => {
      const el = e.target;
      onChange({ [el.name]: el.type === 'checkbox' ? el.checked : el.value });
    });
    form.addEventListener('submit', (e) => e.preventDefault());
    m.el.querySelector('[data-read]')?.addEventListener('click', () => { m.close(); setTimeout(readPage, 300); });
    m.el.querySelector('[data-shortcuts]').addEventListener('click', () => { m.close(); setTimeout(() => showShortcuts({ role: document.documentElement.dataset.role }), 300); });
    translateDom(m.el);
  });
}
