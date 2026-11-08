import { api } from '../api.js';
import { showFieldErrors, setBusy, esc } from '../ui.js';
import { brandHtml, backgroundHtml, HOME, ROLE_LABEL } from '../layout.js';
import { renderAvatar } from '../components/avatar.js';
import { icon } from '../icons.js';

document.getElementById('bg').outerHTML = backgroundHtml();
document.getElementById('brand').innerHTML = brandHtml({ size: 'h-11' });
document.getElementById('brand-mobile').innerHTML = brandHtml({ size: 'h-9' });
document.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = icon(el.dataset.icon, 'h-5 w-5'); });
const SAMPLES = [
  { v: 2, art: 'polished', look: 'doll', skin: 'a36b4f', hair: 'sideComed', hairColor: '2c1b18', rearHair: 'longWavy', facialHair: 'none', clothing: 'turtleNeck', clothesColor: 'ec4899', bg: 'sunset' },
  { v: 2, art: 'classic', look: 'tactical', skin: '614335', hair: 'dreads01', hairColor: '2c1b18', hatColor: '4b5320', facialHair: 'beardMedium', clothing: 'hoodie', clothesColor: '4b5320', graphic: 'skullOutline', accessory: 'sunglasses', accessoryColor: '151613', bg: 'camo' },
  { v: 2, art: 'classic', look: 'runway', skin: 'd08b5b', hair: 'hijab', hairColor: '2c1b18', hatColor: 'd4af37', facialHair: 'none', clothing: 'blazerAndShirt', clothesColor: '151613', graphic: 'diamond', accessory: 'round', accessoryColor: 'd4af37', bg: 'studio' },
];
const LABELS = ['Fashion Doll Glam', 'Tactical Operator', 'Runway Dress-Up'];
document.getElementById('hero-avatars').innerHTML = SAMPLES.map((a, i) => `
  <figure class="animate-float" style="animation-delay:${i * 0.6}s">
    <div class="${i === 1 ? 'h-48 w-40' : 'h-40 w-32'} overflow-hidden rounded-3xl border border-white/15 shadow-2xl">${renderAvatar(a, { state: ['idle', 'idle', 'celebrating'][i], label: LABELS[i], live: true })}</div>
    <figcaption class="mt-2 text-center text-xs text-white/60">${LABELS[i]}</figcaption>
  </figure>`).join('');

const form = document.getElementById('login-form');
const alertBox = document.getElementById('form-alert');
const next = new URLSearchParams(location.search).get('next');
const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null;
const go = (user) => { location.href = user.mustChangePassword ? '/change-password' : safeNext || HOME[user.role]; };

api('/auth/me').then(({ user }) => go(user)).catch(() => {});

form.querySelector('[data-toggle-pw]').addEventListener('click', (e) => {
  const show = form.password.type === 'password';
  form.password.type = show ? 'text' : 'password';
  e.target.textContent = show ? 'Hide' : 'Show';
  e.target.setAttribute('aria-pressed', String(show));
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  alertBox.classList.add('hidden');
  const body = { email: form.email.value.trim(), password: form.password.value };
  const errors = {};
  if (!body.email) errors.email = 'Email is required';
  if (!body.password) errors.password = 'Password is required';
  if (!showFieldErrors(form, errors)) return;

  const btn = form.querySelector('button[type=submit]');
  setBusy(btn, true, 'Signing in…');
  try {
    const { user } = await api('/auth/login', { method: 'POST', body });
    go(user);
  } catch (err) {
    alertBox.textContent = err.message;
    alertBox.classList.remove('hidden');
    form.closest('.glass').animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-8px)' }, { transform: 'translateX(8px)' }, { transform: 'translateX(0)' }], { duration: 300 });
    setBusy(btn, false);
  }
});

// Demo role sign-in (only when DEMO_MODE=true on the server)
const DEMO_INFO = {
  candidate: ['user', 'Journey roadmap, tickets, birthday countdown'],
  support: ['users', 'Ticket queue, workload, update candidates'],
  admin: ['shield', 'Add/remove users, roles, categories, analytics'],
};
api('/auth/demo-accounts').then(({ enabled, accounts }) => {
  if (!enabled || !accounts.length) return;
  document.getElementById('demo').classList.remove('hidden');
  const order = ['candidate', 'support', 'admin'];
  document.getElementById('demo-buttons').innerHTML = accounts.sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role)).map((a) => `
    <button type="button" data-role="${a.role}" class="glow-ring flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-3 text-left transition hover:-translate-y-0.5 hover:bg-white/10">
      <span class="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-purple/50 to-salmon/40">${icon(DEMO_INFO[a.role][0])}</span>
      <span class="min-w-0 flex-1"><span class="block text-sm font-semibold">${ROLE_LABEL[a.role]} <span class="font-normal text-white/50">· ${esc(a.name)}</span></span>
      <span class="block truncate text-xs text-white/50">${DEMO_INFO[a.role][1]}</span></span>
      <span class="text-white/40">${icon('arrowRight', 'h-4 w-4')}</span>
    </button>`).join('');
  document.getElementById('demo-buttons').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-role]');
    if (!b) return;
    const { user } = await api('/auth/demo-login', { method: 'POST', body: { role: b.dataset.role } });
    go(user);
  });
}).catch(() => {});
