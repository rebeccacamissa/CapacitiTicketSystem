import { api } from '../api.js';
import { initPage, applyPreferences } from '../layout.js';
import { esc, toast, setBusy, showFieldErrors, fmtDate, avatarHtml } from '../ui.js';
import { icon } from '../icons.js';
import { createAvatarBuilder } from '../components/avatar-builder.js';
import { onLive } from '../live.js';
import { NEEDS } from '../needs.js';
import { LANGS, getLang, setLanguage, t } from '../i18n.js';

const user = await initPage();
const PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,72}$/;
let { profile: p } = await api('/profile/me');

// ---- Avatar studio ---------------------------------------------------------
createAvatarBuilder(document.getElementById('builder'), {
  initial: p.avatar,
  onSaved: (cfg) => {
    p.avatar = cfg;
    document.querySelectorAll('[data-side-avatar], [data-top-avatar]').forEach((el) => {
      el.innerHTML = avatarHtml({ name: p.fullName, avatar: cfg, id: p.id }, 'h-10 w-10 text-sm');
    });
    loadAchievements();
  },
});
if (location.hash) setTimeout(() => document.querySelector(location.hash)?.scrollIntoView({ behavior: 'smooth' }), 400);

// ---- Achievements ----------------------------------------------------------
async function loadAchievements() {
  const g = await api('/me/progress');
  const pct = (g.levelProgress / g.levelSize) * 100;
  const r = 44, c = 2 * Math.PI * r;
  document.getElementById('ach').innerHTML = `
    <div class="grid gap-6 md:grid-cols-[12rem_1fr]">
      <div class="flex flex-col items-center justify-center rounded-3xl bg-gradient-to-br from-purple/30 to-salmon/20 p-5 text-center">
        <svg viewBox="0 0 100 100" class="h-32 w-32 -rotate-90" aria-hidden="true">
          <circle cx="50" cy="50" r="${r}" stroke="rgb(255 255 255 / .12)" stroke-width="8" fill="none"/>
          <circle cx="50" cy="50" r="${r}" stroke="url(#lvl)" stroke-width="8" fill="none" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c}" class="transition-all duration-1000" data-ring/>
          <defs><linearGradient id="lvl"><stop offset="0" stop-color="#f25251"/><stop offset="1" stop-color="#b08ae7"/></linearGradient></defs>
        </svg>
        <p class="-mt-24 mb-14 font-display text-4xl font-semibold">${g.level}</p>
        <p class="text-sm font-semibold">Level ${g.level}</p>
        <p class="text-xs text-white/60">${g.xp} XP · ${g.levelSize - g.levelProgress} to next level</p>
      </div>
      <ul class="stagger grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">${g.badges.map((b) => `
        <li class="glow-ring relative rounded-2xl border p-3 text-center transition hover:-translate-y-0.5 ${b.earned ? 'border-salmon/30 bg-gradient-to-b from-salmon/15 to-purple/10' : 'border-white/10 bg-white/[0.03] opacity-60'}">
          <span class="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl ${b.earned ? 'bg-gradient-to-br from-salmon to-purple text-snow shadow-lg shadow-salmon/30' : 'bg-white/10 text-white/50'}">${icon(b.earned ? b.icon : 'lock', 'h-6 w-6')}</span>
          <p class="mt-2 text-sm font-semibold">${esc(b.name)}</p>
          <p class="text-[0.7rem] leading-snug text-white/55">${esc(b.description)}</p>
          ${b.earned ? `<p class="mt-1 text-[0.65rem] text-salmon-50">Earned ${fmtDate(b.awardedAt)}</p>` : ''}
        </li>`).join('')}</ul>
    </div>
    <p class="mt-4 text-xs text-white/50">Badges unlock extra avatar items: outfits, accessories, hair styles and backdrops.</p>`;
  requestAnimationFrame(() => setTimeout(() => { const ring = document.querySelector('[data-ring]'); if (ring) ring.style.strokeDashoffset = String(c * (1 - pct / 100)); }, 80));
}
loadAchievements();
onLive('xp', loadAchievements);

// ---- Personal details -----------------------------------------------------
const form = document.getElementById('details');
form.firstName.value = p.firstName || '';
form.surname.value = p.surname || '';
form.dateOfBirth.value = p.dateOfBirth || '';
form.gender.value = p.gender || 'prefer-not';
form.email.value = p.email;
const item = (k, v) => `<div class="rounded-xl bg-white/[0.04] px-3 py-2"><p class="text-xs text-white/50">${k}</p><p class="text-sm font-medium">${v ? esc(v) : '<span class="text-white/35">Not set</span>'}</p></div>`;
document.getElementById('role-details').innerHTML = p.candidate
  ? `${item('Cohort', p.candidate.cohort)}${item('Stream', p.candidate.stream)}${item('Mentor', p.candidate.mentor)}${item('Tech Champ', p.candidate.techChamp)}${item('Supervisor', p.candidate.supervisor)}
     <p class="self-center text-xs text-white/45 sm:col-span-2">Programme details are maintained by your support team. Ask Cammy or raise a request if something is wrong.</p>`
  : `${item('Position', p.staff?.position)}${item('Employee ID', p.staff?.employeeId)}`;

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = form.querySelector('button');
  setBusy(btn, true, 'Saving…');
  try {
    ({ profile: p } = await api('/profile/me', { method: 'PATCH', body: {
      firstName: form.firstName.value.trim() || undefined, surname: form.surname.value.trim() || undefined,
      dateOfBirth: form.dateOfBirth.value || undefined, gender: form.gender.value,
    } }));
    toast('Details saved', 'success');
    showFieldErrors(form, {});
  } catch (err) { toast(err.message, 'error'); showFieldErrors(form, err.details?.fields); }
  setBusy(btn, false);
});

// ---- Accessibility & language -------------------------------------------------
document.getElementById('open-a11y').addEventListener('click', () => document.getElementById('a11y-btn').click());
const langSel = document.getElementById('language');
langSel.innerHTML = LANGS.map((l) => `<option value="${l.code}" lang="${l.code}" ${l.code === getLang() ? 'selected' : ''}>${l.native}</option>`).join('');
langSel.addEventListener('change', () => setLanguage(langSel.value));
document.getElementById('replay-tour').addEventListener('click', () => import('../components/tour.js').then((m) => m.startTour(user, { avatar: p.avatar })));

// ---- Accessibility needs ---------------------------------------------------
const mine = new Set(p.accessibility?.needs || []);
document.getElementById('needs-list').innerHTML = NEEDS.map(([k, label]) => `
  <label class="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-3 text-sm transition hover:border-white/25 has-[:checked]:border-salmon has-[:checked]:bg-salmon/10">
    <input type="checkbox" name="need" value="${k}" class="mt-0.5 h-4 w-4 accent-salmon" ${mine.has(k) ? 'checked' : ''}>${esc(label)}</label>`).join('');
document.getElementById('needs-notes').value = p.accessibility?.notes || '';
document.getElementById('needs-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button.btn-primary');
  setBusy(btn, true, 'Saving…');
  try {
    const needs = [...e.target.querySelectorAll('input[name=need]:checked')].map((i) => i.value);
    await api('/profile/accessibility', { method: 'PUT', body: { needs, notes: e.target.notes.value } });
    toast('Your accessibility needs were saved', 'success');
  } catch (err) { toast(err.message, 'error'); }
  setBusy(btn, false);
});

// ---- Password ------------------------------------------------------------
const pw = document.getElementById('password-form');
pw.addEventListener('submit', async (e) => {
  e.preventDefault();
  const errs = {};
  if (!pw.currentPassword.value) errs.currentPassword = 'Enter your current password';
  if (!PASSWORD_RE.test(pw.newPassword.value)) errs.newPassword = '8+ characters with upper-case, lower-case and a number';
  if (pw.confirm.value !== pw.newPassword.value) errs.confirm = 'Passwords do not match';
  if (!showFieldErrors(pw, errs)) return;
  const btn = pw.querySelector('button');
  setBusy(btn, true, 'Updating…');
  try {
    await api('/auth/change-password', { method: 'POST', body: { currentPassword: pw.currentPassword.value, newPassword: pw.newPassword.value } });
    toast('Password updated', 'success');
    pw.reset();
  } catch (err) { toast(err.message, 'error'); showFieldErrors(pw, err.details?.fields); }
  setBusy(btn, false);
});
