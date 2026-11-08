import { api } from '../api.js';
import { initPage } from '../layout.js';
import { esc, toast, setBusy } from '../ui.js';
import { feedItem, wireReactions } from '../components/feed-item.js';
import { onLive } from '../live.js';

const user = await initPage();
const staff = user.role !== 'candidate';
const list = document.getElementById('feed');
let posts = [];

if (staff) {
  const form = document.getElementById('compose');
  form.hidden = false;
  const { cohorts } = await api('/meta/options');
  form.cohort.insertAdjacentHTML('beforeend', cohorts.map((c) => `<option>${esc(c)}</option>`).join(''));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = form.body.value.trim();
    if (!body) return form.body.focus();
    const btn = form.querySelector('button');
    setBusy(btn, true, 'Posting…');
    try {
      await api('/feed', { method: 'POST', body: { body, cohort: form.cohort.value || undefined } });
      form.reset();
      toast('Announcement posted', 'success');
      await load();
    } catch (err) { toast(err.message, 'error'); }
    setBusy(btn, false);
  });
}

async function load() {
  ({ posts } = await api('/feed', { query: { limit: 20 } }));
  render();
}
function render() {
  list.innerHTML = posts.length ? posts.map((p) => feedItem(p, { canDelete: staff })).join('') : '<li class="card text-center text-sm text-white/60">No posts yet.</li>';
  document.getElementById('more').hidden = posts.length < 20;
  document.getElementById('new-posts').classList.add('hidden');
}
document.getElementById('more').addEventListener('click', async () => {
  const { posts: older } = await api('/feed', { query: { limit: 20, before: posts.at(-1).id } });
  posts = posts.concat(older);
  render();
});
wireReactions(list, load);

// Live: reactions refresh in place; brand-new posts show a "new posts" pill instead of jumping the page.
onLive('feed', async (d) => {
  if (d?.reaction || window.scrollY < 200) return load();
  document.getElementById('new-posts').classList.remove('hidden');
});
document.querySelector('#new-posts button').addEventListener('click', () => { load(); window.scrollTo({ top: 0, behavior: 'smooth' }); });

load();
