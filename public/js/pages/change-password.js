import { api } from '../api.js';
import { showFieldErrors, setBusy, toast } from '../ui.js';
import { brandHtml, backgroundHtml, HOME } from '../layout.js';

document.getElementById('bg').outerHTML = backgroundHtml();
document.getElementById('brand').innerHTML = brandHtml({ size: 'h-8' });

const { user } = await api('/auth/me');
if (!user.mustChangePassword) location.replace(HOME[user.role]);
document.getElementById('name').textContent = user.firstName;

const form = document.getElementById('pw');
const PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,72}$/;
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const errs = {};
  if (!form.currentPassword.value) errs.currentPassword = 'Enter the temporary password';
  if (!PASSWORD_RE.test(form.newPassword.value)) errs.newPassword = '8+ characters with upper-case, lower-case and a number';
  if (form.confirm.value !== form.newPassword.value) errs.confirm = 'Passwords do not match';
  if (!showFieldErrors(form, errs)) return;
  const btn = form.querySelector('button.btn');
  setBusy(btn, true, 'Saving…');
  try {
    await api('/auth/change-password', { method: 'POST', body: { currentPassword: form.currentPassword.value, newPassword: form.newPassword.value } });
    toast('Password set — welcome aboard!', 'success');
    setTimeout(() => { location.href = HOME[user.role]; }, 700);
  } catch (err) {
    showFieldErrors(form, err.details?.fields || {});
    toast(err.message, 'error');
    setBusy(btn, false);
  }
});
document.getElementById('logout').addEventListener('click', async () => { await api('/auth/logout', { method: 'POST' }); location.href = '/'; });
