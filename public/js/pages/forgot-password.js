import { api } from '../api.js';
import { showFieldErrors, setBusy, toast } from '../ui.js';
import { brandHtml, backgroundHtml } from '../layout.js';

document.getElementById('bg').outerHTML = backgroundHtml();
document.getElementById('brand').innerHTML = brandHtml({ size: 'h-8' });

const form = document.getElementById('forgot');
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = form.email.value.trim();
  if (!showFieldErrors(form, /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? {} : { email: 'Enter a valid email address' })) return;
  const btn = form.querySelector('button');
  setBusy(btn, true, 'Sending…');
  try {
    const res = await api('/auth/forgot-password', { method: 'POST', body: { email } });
    form.classList.add('hidden');
    document.getElementById('sent-msg').textContent = res.message;
    document.getElementById('sent').classList.remove('hidden');
  } catch (err) {
    showFieldErrors(form, err.details?.fields || {});
    toast(err.message, 'error');
    setBusy(btn, false);
  }
});
