// Shared attachment picker + list rendering.
import { api } from '../api.js';
import { esc, toast } from '../ui.js';
import { icon } from '../icons.js';

const ALLOWED = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'pdf', 'docx', 'xlsx', 'txt'];
const MAX = 5 * 1024 * 1024;
const fmtSize = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** Picker UI inside `root`. Returns { files(): File[], clear() }. */
export function createPicker(root, { label = 'Attach files' } = {}) {
  let files = [];
  root.innerHTML = `
    <div class="flex flex-wrap items-center gap-2">
      <label class="chip cursor-pointer">${icon('paperclip', 'h-3.5 w-3.5')}${label}
        <input type="file" multiple class="sr-only" accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.docx,.xlsx,.txt" data-input></label>
      <span class="text-xs text-white/40">Up to 5 files · 5 MB each · images, PDF, Word, Excel, text</span>
    </div>
    <ul class="mt-2 flex flex-wrap gap-2" data-list></ul>`;
  const list = root.querySelector('[data-list]');
  const render = () => {
    list.innerHTML = files.map((f, i) => `<li class="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] py-1 pr-1 pl-2.5 text-xs animate-pop">
      ${icon(f.type.startsWith('image/') ? 'image' : 'file', 'h-3.5 w-3.5 text-salmon-50')}<span class="max-w-40 truncate">${esc(f.name)}</span><span class="text-white/40">${fmtSize(f.size)}</span>
      <button type="button" data-rm="${i}" class="rounded-lg p-1 text-white/50 hover:bg-white/10 hover:text-white" aria-label="Remove ${esc(f.name)}">${icon('close', 'h-3 w-3')}</button></li>`).join('');
  };
  root.querySelector('[data-input]').addEventListener('change', (e) => {
    for (const f of e.target.files) {
      const ext = f.name.split('.').pop().toLowerCase();
      if (!ALLOWED.includes(ext)) { toast(`${f.name}: file type not allowed`, 'error'); continue; }
      if (f.size > MAX) { toast(`${f.name} is larger than 5 MB`, 'error'); continue; }
      if (files.length >= 5) { toast('You can attach up to 5 files', 'error'); break; }
      files.push(f);
    }
    e.target.value = '';
    render();
  });
  list.addEventListener('click', (e) => { const b = e.target.closest('[data-rm]'); if (b) { files.splice(Number(b.dataset.rm), 1); render(); } });
  return { files: () => files, clear: () => { files = []; render(); } };
}

const toDataUrl = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });

export async function uploadFiles(requestId, files, { isInternal = false } = {}) {
  if (!files.length) return;
  const payload = await Promise.all(files.map(async (f) => ({ name: f.name, data: await toDataUrl(f) })));
  await api(`/requests/${requestId}/attachments`, { method: 'POST', body: { files: payload, isInternal } });
}

export function attachmentList(items) {
  if (!items?.length) return '';
  return `<ul class="mt-3 grid gap-2 sm:grid-cols-2">${items.map((a) => {
    const img = a.mime.startsWith('image/');
    return `<li><a href="/api/requests/attachments/${a.id}" target="_blank" rel="noopener" class="group flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-2 transition hover:border-white/25 hover:bg-white/[0.07]">
      ${img ? `<img src="/api/requests/attachments/${a.id}" alt="" class="h-12 w-12 rounded-lg object-cover" loading="lazy">` : `<span class="flex h-12 w-12 items-center justify-center rounded-lg bg-white/10 text-salmon-50">${icon('file', 'h-5 w-5')}</span>`}
      <span class="min-w-0 flex-1"><span class="block truncate text-sm font-medium group-hover:text-salmon-50">${esc(a.name)}</span>
      <span class="block text-xs text-white/45">${fmtSize(a.size)} · ${esc(a.uploader)}${a.is_internal ? ' · <span class="text-warn">Internal</span>' : ''}</span></span>
      <span class="text-white/40">${icon('download', 'h-4 w-4')}</span></a></li>`;
  }).join('')}</ul>`;
}
