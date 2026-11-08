import { api } from '../api.js';
import { initPage } from '../layout.js';
import { esc, showFieldErrors, setBusy, toast } from '../ui.js';
import { categoryIcon } from '../icons.js';
import { createPicker, uploadFiles } from '../components/attachments-ui.js';

await initPage({ roles: ['candidate'] });

const form = document.getElementById('request-form');
const alertBox = document.getElementById('form-alert');
const grid = document.getElementById('cat-grid');
const { categories } = await api('/requests/categories');

grid.innerHTML = categories.map((c) => `
  <label class="group relative flex cursor-pointer flex-col items-center gap-1.5 rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-center transition duration-200 hover:-translate-y-0.5 hover:border-white/25 has-[:checked]:border-salmon has-[:checked]:bg-gradient-to-b has-[:checked]:from-salmon/20 has-[:checked]:to-purple/20 has-[:checked]:shadow-lg has-[:checked]:shadow-salmon/20">
    <input type="radio" name="cat" value="${c.id}" class="sr-only">
    <span class="text-salmon-50 transition group-hover:scale-110">${categoryIcon(c.name, 'h-6 w-6')}</span>
    <span class="text-xs font-medium leading-tight">${esc(c.name)}</span>
  </label>`).join('');

function pick(id) {
  const c = categories.find((x) => String(x.id) === String(id));
  form.categoryId.value = c ? c.id : '';
  document.getElementById('cat-desc').textContent = c ? c.description || '' : '';
  const radio = grid.querySelector(`input[value="${c?.id}"]`);
  if (radio) radio.checked = true;
}
grid.addEventListener('change', (e) => pick(e.target.value));

// Pre-select from ?category=Name (used by Cammy suggestions)
const pre = new URLSearchParams(location.search).get('category');
if (pre) pick(categories.find((c) => c.name.toLowerCase() === pre.toLowerCase())?.id);

const picker = createPicker(document.getElementById('attach'), { label: 'Attach screenshots or documents' });

form.description.addEventListener('input', () => {
  document.getElementById('desc-count').textContent = `${form.description.value.length} / 5000`;
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  alertBox.classList.add('hidden');
  const body = {
    categoryId: Number(form.categoryId.value) || undefined,
    priority: form.priority.value,
    title: form.title.value.trim(),
    description: form.description.value.trim(),
  };
  const errors = {};
  if (!body.categoryId) errors.categoryId = 'Please choose a category';
  if (body.title.length < 5) errors.title = 'Subject must be at least 5 characters';
  if (body.description.length < 10) errors.description = 'Please give a bit more detail (10+ characters)';
  if (!showFieldErrors(form, errors)) return;

  const btn = form.querySelector('button[type=submit]');
  setBusy(btn, true, 'Submitting…');
  try {
    const { request } = await api('/requests', { method: 'POST', body });
    try { await uploadFiles(request.id, picker.files()); } catch (err) { toast(`Request created, but attachments failed: ${err.message}`, 'error'); }
    form.classList.add('hidden');
    document.getElementById('ref').textContent = request.reference;
    document.getElementById('view-link').href = `/request?id=${request.id}`;
    const success = document.getElementById('success');
    success.classList.remove('hidden');
    success.classList.add('animate-pop');
    success.focus();
  } catch (err) {
    alertBox.textContent = err.message;
    alertBox.classList.remove('hidden');
    showFieldErrors(form, err.details?.fields);
    setBusy(btn, false);
  }
});

