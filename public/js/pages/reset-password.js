import { api } from '../api.js';
import { showFieldErrors, setBusy, toast } from '../ui.js';
import { brandHtml, backgroundHtml } from '../layout.js';

document.getElementById('bg').outerHTML = backgroundHtml();
document.getElementById('brand').innerHTML = brandHtml({ size: 'h-8' });

// Read the token, then remove it from the address bar and history.
const token = new URLSearchParams(location.search).get('token') || '';
history.replaceState(null, '', location.pathname);

const form = document.getElementById('reset');
const PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,72}$/;
if (token.length < 20) {
  toast('This reset link is incomplete. Request a new one.', 'error');
}
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const errs = {};
  if (!PASSWORD_RE.test(form.newPassword.value)) errs.newPassword = '8+ characters with upper-case, lower-case and a number';
  if (form.confirm.value !== form.newPassword.value) errs.confirm = 'Passwords do not match';
  if (!showFieldErrors(form, errs)) return;
  const btn = form.querySelector('button');
  setBusy(btn, true, 'Saving…');
  try {
    await api('/auth/reset-password', { method: 'POST', body: { token, newPassword: form.newPassword.value } });
    toast('Password updated. You can sign in now.', 'success');
    setTimeout(() => { location.href = '/'; }, 900);
  } catch (err) {
    showFieldErrors(form, err.details?.fields || {});
    toast(err.message, 'error');
    setBusy(btn, false);
  }
});
