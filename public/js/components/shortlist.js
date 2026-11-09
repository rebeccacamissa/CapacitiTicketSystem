// Recruiter shortlist toggle. The shortlist is private: saved per recruiter on the server.
import { api } from '../api.js';
import { esc, toast, t } from '../ui.js';
import { icon } from '../icons.js';

export function shortlistButton(c, { label = true } = {}) {
  const on = !!c.shortlisted;
  return `<button type="button" data-shortlist="${c.id}" data-on="${on}" aria-pressed="${on}"
    class="btn btn-sm ${on ? 'btn-primary' : 'btn-ghost'}" aria-label="${on ? t('Remove {name} from my shortlist', { name: esc(c.fullName) }) : t('Add {name} to my shortlist', { name: esc(c.fullName) })}">
    ${icon('star', 'h-4 w-4')}${label ? (on ? t('Shortlisted') : t('Shortlist')) : ''}</button>`;
}

/** Handle clicks on any [data-shortlist] inside root. onChange(id, shortlisted) lets the page update its data. */
export function wireShortlist(root, onChange = () => {}) {
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-shortlist]');
    if (!b) return;
    const id = Number(b.dataset.shortlist);
    const on = b.dataset.on === 'true';
    b.disabled = true;
    try {
      if (on) await api(`/recruiter/shortlist/${id}`, { method: 'DELETE' });
      else await api(`/recruiter/shortlist/${id}`, { method: 'PUT', body: {} });
      toast(on ? t('Removed from your shortlist') : t('Added to your shortlist'), 'success');
      onChange(id, !on);
    } catch (err) { toast(err.message, 'error'); }
    b.disabled = false;
  });
}
