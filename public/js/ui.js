// Shared UI helpers. All dynamic text goes through esc() before hitting innerHTML.
import { icon } from './icons.js';
import { t, langInfo } from './i18n.js';
import { announce } from './a11y.js';
export { t };
import { renderAvatar } from './components/avatar.js';
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const reduceMotion = () => document.documentElement.dataset.motion === 'reduce' || matchMedia('(prefers-reduced-motion: reduce)').matches;

const LOCALES = [langInfo().speech, 'en-ZA'];
const dtf = new Intl.DateTimeFormat(LOCALES, { day: 'numeric', month: 'short', year: 'numeric' });
const dtfTime = new Intl.DateTimeFormat(LOCALES, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export const fmtDate = (iso) => (iso ? dtf.format(new Date(iso.length === 10 ? `${iso}T00:00:00` : iso)) : '—');
export const fmtDateTime = (iso) => (iso ? dtfTime.format(new Date(iso)) : '—');

export function fmtRelative(iso) {
  if (!iso) return '—';
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(LOCALES, { numeric: 'auto' });
  const units = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [unit, secs] of units) if (Math.abs(diff) >= secs) return rtf.format(Math.round(diff / secs), unit);
  return t('just now');
}

// ---- Badges (status colours are reserved and always paired with an icon + label) ----
const STATUS_STYLES = {
  'Open': 'bg-purple/25 text-purple-30 ring-1 ring-purple-50/30',
  'Assigned': 'bg-white/10 text-white/85 ring-1 ring-white/15',
  'In Progress': 'bg-purple-50/20 text-purple-30 ring-1 ring-purple-50/30',
  'Waiting for Candidate': 'bg-warn/15 text-warn ring-1 ring-warn/30',
  'Resolved': 'bg-ok/15 text-ok ring-1 ring-ok/30',
  'Closed': 'bg-white/5 text-white/50 ring-1 ring-white/10',
  'Reopened': 'bg-salmon/20 text-salmon-50 ring-1 ring-salmon/30',
};
const STATUS_ICONS = { 'Open': 'circle', 'Assigned': 'user', 'In Progress': 'refresh', 'Waiting for Candidate': 'hourglass', 'Resolved': 'check', 'Closed': 'square', 'Reopened': 'undo' };
export const statusBadge = (s) =>
  `<span class="badge ${STATUS_STYLES[s] || 'bg-white/10 text-white'}">${icon(STATUS_ICONS[s] || 'circle', 'h-3 w-3')}${esc(t(s))}</span>`;

const PRIORITY_STYLES = {
  Low: 'bg-white/10 text-white/70',
  Medium: 'bg-purple/25 text-purple-30',
  High: 'bg-salmon/20 text-salmon-50',
  Urgent: 'bg-salmon text-snow shadow-md shadow-salmon/40',
};
export const priorityBadge = (p) => `<span class="badge ${PRIORITY_STYLES[p] || ''}">${esc(t(p))}</span>`;
export const overdueBadge = () => `<span class="badge bg-warn/15 text-warn ring-1 ring-warn/30">${icon('alert', 'h-3 w-3')}${t('Overdue')}</span>`;

// ---- Avatars ----
const GRADIENTS = ['from-purple to-salmon', 'from-salmon to-pink', 'from-purple-80 to-purple-30', 'from-kadet-80 to-purple', 'from-salmon-80 to-purple-80'];
export const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');

/** Avatar (head crop of the user's design) with initials fallback. size = tailwind size classes. */
export function avatarHtml({ name, avatar, id = 0 }, size = 'h-10 w-10 text-sm', extra = '') {
  if (avatar) {
    return `<span class="${size} ${extra} inline-block shrink-0 overflow-hidden rounded-full ring-2 ring-white/15" title="${esc(name)}">${renderAvatar(avatar, { crop: 'head', animated: false, label: name })}</span>`;
  }
  const g = GRADIENTS[Number(id) % GRADIENTS.length];
  return `<span class="${size} ${extra} inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${g} font-semibold text-snow ring-2 ring-white/15" aria-hidden="true">${esc(initials(name))}</span>`;
}

// ---- Motion helpers ----
/** Animate numbers in elements with [data-count]. */
export function countUp(root = document) {
  root.querySelectorAll('[data-count]').forEach((el) => {
    const target = Number(el.dataset.count);
    const decimals = Number(el.dataset.decimals || 0);
    const suffix = el.dataset.suffix || '';
    if (reduceMotion() || !Number.isFinite(target)) { el.textContent = target.toFixed(decimals) + suffix; return; }
    const start = performance.now();
    const dur = 1100;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 4);
      el.textContent = (target * eased).toFixed(decimals) + suffix;
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** Smooth SVG sparkline path (single series). */
export function sparkline(values, { w = 120, h = 36, stroke = '#f25251', fill = true } = {}) {
  if (!values.length) return '';
  const max = Math.max(1, ...values);
  const step = w / Math.max(1, values.length - 1);
  const pts = values.map((v, i) => [i * step, h - 4 - (v / max) * (h - 8)]);
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]; const [x1, y1] = pts[i];
    const cx = (x0 + x1) / 2;
    d += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`;
  }
  const id = `sg${Math.random().toString(36).slice(2, 8)}`;
  return `<svg viewBox="0 0 ${w} ${h}" class="h-9 w-full overflow-visible" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${stroke}" stop-opacity=".35"/><stop offset="1" stop-color="${stroke}" stop-opacity="0"/></linearGradient></defs>
    ${fill ? `<path d="${d} L${w},${h} L0,${h} Z" fill="url(#${id})" class="animate-fade-up"/>` : ''}
    <path d="${d}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" class="draw" style="--len:400"/>
  </svg>`;
}

/** Subtle 3D tilt that follows the pointer. */
export function tilt(el, max = 5) {
  if (reduceMotion() || matchMedia('(hover: none)').matches) return;
  el.style.transition = 'transform .25s ease-out';
  el.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `perspective(1000px) rotateX(${-y * max}deg) rotateY(${x * max}deg)`;
  });
  el.addEventListener('pointerleave', () => { el.style.transform = ''; });
}

// ---- Toasts ----
export function toast(message, type = 'info') {
  message = t(message);
  let region = document.getElementById('toast-region');
  if (!region) {
    region = document.createElement('div');
    region.id = 'toast-region';
    region.setAttribute('aria-live', 'polite');
    region.className = 'pointer-events-none fixed inset-x-0 top-4 z-[80] flex flex-col items-center gap-2 px-4';
    document.body.append(region);
  }
  const el = document.createElement('div');
  const tone = type === 'error' ? 'border-salmon/50 text-salmon-50' : type === 'success' ? 'border-ok/40 text-ok' : 'border-white/20 text-white';
  const ic = icon(type === 'error' ? 'alert' : type === 'success' ? 'checkCircle' : 'info', 'h-4 w-4 shrink-0');
  el.className = `pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl border bg-night/90 px-4 py-3 text-sm font-medium shadow-2xl backdrop-blur-xl transition duration-300 -translate-y-3 opacity-0 ${tone}`;
  el.innerHTML = `${ic}<span class="text-white">${esc(message)}</span><button type="button" class="-mr-1 rounded-lg p-1 text-white/60 hover:bg-white/10 hover:text-white" aria-label="${t('Dismiss')}">${icon('close', 'h-3.5 w-3.5')}</button>`;
  region.append(el);
  requestAnimationFrame(() => el.classList.remove('-translate-y-3', 'opacity-0'));
  const dismiss = () => { el.classList.add('opacity-0', '-translate-y-3'); setTimeout(() => el.remove(), 300); };
  let timer = setTimeout(dismiss, 6500);
  const pause = () => clearTimeout(timer);
  const resume = () => { clearTimeout(timer); timer = setTimeout(dismiss, 3000); };
  el.addEventListener('mouseenter', pause); el.addEventListener('mouseleave', resume);
  el.addEventListener('focusin', pause); el.addEventListener('focusout', resume);
  el.querySelector('button').addEventListener('click', dismiss);
  if (type === 'error') announce(message, true);
}

// ---- Modal (native <dialog>, animated) ----
export function openModal(html, { wide = false } = {}) {
  const dlg = document.createElement('dialog');
  dlg.className = `modal glass-strong m-auto w-[calc(100%-2rem)] ${wide ? 'max-w-2xl' : 'max-w-md'} p-0 text-white`;
  dlg.innerHTML = html;
  document.body.append(dlg);
  dlg.showModal();
  requestAnimationFrame(() => requestAnimationFrame(() => { dlg.dataset.open = 'true'; }));
  const close = () => {
    dlg.dataset.open = 'false';
    setTimeout(() => { dlg.close(); dlg.remove(); }, reduceMotion() ? 0 : 280);
  };
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('[data-close]')) close(); });
  return { el: dlg, close };
}

/** Show server-side field errors next to inputs. */
export function showFieldErrors(form, fields = {}) {
  form.querySelectorAll('[data-error-for]').forEach((el) => { el.textContent = ''; });
  form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  let first = null;
  for (const [name, msg] of Object.entries(fields)) {
    const input = form.elements[name];
    const slot = form.querySelector(`[data-error-for="${name}"]`);
    if (slot) { slot.id ||= `err-${name}-${Math.random().toString(36).slice(2, 7)}`; slot.textContent = t(msg); }
    if (input && input.setAttribute) {
      input.setAttribute('aria-invalid', 'true');
      if (slot) input.setAttribute('aria-describedby', [input.getAttribute('aria-describedby'), slot.id].filter(Boolean).join(' '));
      first ||= input;
    }
  }
  if (first) announce(t('Please correct the highlighted fields'), true);
  first?.focus?.();
  return !first;
}

export function setBusy(button, busy, label = 'Working…') {
  if (!button) return;
  if (busy) { button.dataset.label = button.innerHTML; button.textContent = t(label); button.disabled = true; button.setAttribute('aria-busy', 'true'); }
  else { button.innerHTML = button.dataset.label || button.innerHTML; button.disabled = false; button.removeAttribute('aria-busy'); }
}

/** Tiny safe markdown: **bold**, line breaks, bullets. Input is escaped first. */
export const miniMd = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong class="text-white">$1</strong>').replace(/\n/g, '<br>');

export const qs = (sel, root = document) => root.querySelector(sel);
