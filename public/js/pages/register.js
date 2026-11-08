import { api } from '../api.js';
import { showFieldErrors, setBusy, esc, toast, reduceMotion } from '../ui.js';
import { brandHtml, backgroundHtml } from '../layout.js';
import { createAvatarBuilder } from '../components/avatar-builder.js';

document.getElementById('bg').outerHTML = backgroundHtml();
document.getElementById('brand').innerHTML = brandHtml({ size: 'h-8' });

const form = document.getElementById('reg');
const alertBox = document.getElementById('form-alert');
const sections = [...form.querySelectorAll('[data-step]')];
const btnNext = document.getElementById('next');
const btnBack = document.getElementById('back');
const btnSkip = document.getElementById('skip');
const LABELS = ['About you', 'Programme', 'Security', 'Avatar'];
const PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,72}$/;
let step = 0;
let registered = false;
let builderStarted = false;
let newUser = null;

// Options
api('/meta/options').then((o) => {
  document.getElementById('cohorts').innerHTML = o.cohorts.map((c) => `<option value="${esc(c)}">`).join('');
  form.stream.insertAdjacentHTML('beforeend', o.streams.map((s) => `<option>${esc(s)}</option>`).join(''));
});
const maxDob = new Date(); maxDob.setFullYear(maxDob.getFullYear() - 15);
form.dateOfBirth.max = maxDob.toISOString().slice(0, 10);

function renderSteps() {
  document.getElementById('steps').innerHTML = LABELS.map((l, i) => `
    <li class="text-xs ${i <= step ? 'text-white' : 'text-white/40'}" ${i === step ? 'aria-current="step"' : ''}>
      <span class="mb-2 block h-1.5 overflow-hidden rounded-full bg-white/10"><span class="block h-full rounded-full bg-gradient-to-r from-purple to-salmon transition-all duration-500 ${i < step ? 'w-full' : i === step ? 'w-1/2' : 'w-0'}"></span></span>
      <span class="font-semibold">${i + 1}.</span> ${l}
    </li>`).join('');
}

function show(n) {
  const dir = n > step ? 1 : -1;
  const from = sections[step];
  const to = sections[n];
  step = n;
  renderSteps();
  from.hidden = true;
  to.hidden = false;
  if (!reduceMotion()) to.animate([{ opacity: 0, transform: `translateX(${dir * 28}px)` }, { opacity: 1, transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.22,1,.36,1)' });
  btnBack.hidden = step === 0 || registered;
  btnSkip.hidden = step !== 3;
  btnNext.textContent = step === 2 ? 'Create account' : step === 3 ? 'Go to my dashboard' : 'Continue';
  btnSkip.textContent = 'Keep the default';
  to.querySelector('input,select')?.focus();
  if (step === 3 && !builderStarted) {
    builderStarted = true;
    document.getElementById('reg-card').classList.replace('max-w-2xl', 'max-w-5xl');
    createAvatarBuilder(document.getElementById('studio'), {
      initial: newUser.avatar,
      saveLabel: 'Save my avatar',
      onSaved: () => { btnNext.textContent = 'Go to my dashboard'; },
    });
  }
}

form.password.addEventListener('input', () => {
  const v = form.password.value;
  const score = [v.length >= 8, /[a-z]/.test(v) && /[A-Z]/.test(v), /\d/.test(v), v.length >= 12 || /[^A-Za-z0-9]/.test(v)].filter(Boolean).length;
  const colours = ['bg-salmon', 'bg-salmon-80', 'bg-warn', 'bg-ok'];
  [...document.querySelectorAll('#pw-meter span')].forEach((s, i) => { s.className = `h-1.5 rounded-full transition-colors duration-300 ${i < score ? colours[score - 1] : 'bg-white/10'}`; });
  document.getElementById('pw-meter-label').textContent = ['8+ characters with upper-case, lower-case and a number.', 'Weak', 'Getting there', 'Good', 'Strong'][score];
});

function validateStep() {
  const e = {};
  if (step === 0) {
    if (!form.firstName.value.trim()) e.firstName = 'First name is required';
    if (!form.surname.value.trim()) e.surname = 'Surname is required';
    if (!form.dateOfBirth.value) e.dateOfBirth = 'Date of birth is required';
    else if (form.dateOfBirth.value > form.dateOfBirth.max) e.dateOfBirth = 'You must be at least 15 years old';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.value.trim())) e.email = 'Enter a valid email address';
    if (!form.gender.value) e.gender = 'Please choose an option';
  }
  if (step === 2) {
    if (!PASSWORD_RE.test(form.password.value)) e.password = 'Password needs 8+ characters with upper-case, lower-case and a number';
    if (form.confirm.value !== form.password.value) e.confirm = 'Passwords do not match';
  }
  return showFieldErrors(form, e);
}

const FIELD_STEP = { firstName: 0, surname: 0, dateOfBirth: 0, gender: 0, email: 0, password: 2 };

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  alertBox.classList.add('hidden');
  if (!validateStep()) return;

  if (step < 2) return show(step + 1);

  if (step === 2) {
    setBusy(btnNext, true, 'Creating account…');
    const v = (n) => form[n].value.trim() || undefined;
    try {
      ({ user: newUser } = await api('/auth/register', { method: 'POST', body: {
        firstName: v('firstName'), surname: v('surname'), dateOfBirth: v('dateOfBirth'), gender: form.gender.value, email: v('email'), password: form.password.value,
        cohort: v('cohort'), stream: v('stream'), mentor: v('mentor'), techChamp: v('techChamp'), supervisor: v('supervisor'),
      } }));
      registered = true;
      setBusy(btnNext, false);
      toast('Account created. Now design your avatar.', 'success');
      show(3);
    } catch (err) {
      setBusy(btnNext, false);
      alertBox.textContent = err.message;
      alertBox.classList.remove('hidden');
      const fields = err.details?.fields || (err.code === 'EMAIL_TAKEN' ? { email: err.message } : {});
      const firstBad = Object.keys(fields).map((f) => FIELD_STEP[f]).filter((s) => s !== undefined).sort()[0];
      if (firstBad !== undefined && firstBad !== step) show(firstBad);
      showFieldErrors(form, fields);
    }
    return;
  }

  // step 3: finish (saving the avatar is optional, via the studio's own Save button)
  location.href = '/dashboard';
});

btnBack.addEventListener('click', () => show(step - 1));
btnSkip.addEventListener('click', () => { location.href = '/dashboard'; });
renderSteps();
