import { api } from '../api.js';
import { initPage } from '../layout.js';
import { esc, toast } from '../ui.js';

await initPage({ roles: ['recruiter'] });
const search = document.getElementById('talent-search');
const streamFilter = document.getElementById('stream-filter');
const stageFilter = document.getElementById('stage-filter');
const rows = document.getElementById('talent-rows');
let requestId = 0;

async function loadTalent() {
  const currentRequest = ++requestId;
  const selectedStream = streamFilter.value;
  const selectedStage = stageFilter.value;
  try {
    const data = await api('/recruiter/talent', {
      query: { q: search.value.trim(), stream: streamFilter.value, stage: stageFilter.value },
    });
    if (currentRequest !== requestId) return;
    streamFilter.innerHTML = '<option value="">All streams</option>' + data.streams.map((stream) => `<option value="${esc(stream)}">${esc(stream)}</option>`).join('');
    stageFilter.innerHTML = '<option value="">All stages</option>' + data.stages.map((stage) => `<option value="${esc(stage.key)}">${esc(stage.title)}</option>`).join('');
    streamFilter.value = data.streams.includes(selectedStream) ? selectedStream : '';
    stageFilter.value = data.stages.some((stage) => stage.key === selectedStage) ? selectedStage : '';
    rows.innerHTML = data.candidates.length ? data.candidates.map((candidate) => `
      <tr class="transition hover:bg-white/[0.03]">
        <td class="px-5 py-4"><p class="font-medium">${esc(candidate.fullName)}</p><p class="text-xs text-white/50">${esc(candidate.email)}</p></td>
        <td class="px-5 py-4 text-white/70">${esc(candidate.stream || '—')}</td>
        <td class="px-5 py-4"><span class="chip">${esc(candidate.stageLabel)}</span></td>
        <td class="px-5 py-4"><a class="text-sm font-semibold text-salmon-50 hover:underline" href="/candidate-profiles?id=${candidate.id}">View portfolio →</a></td>
      </tr>`).join('') : '<tr><td colspan="4" class="px-5 py-12 text-center text-white/55">No shared candidate portfolios yet</td></tr>';
  } catch (error) {
    if (currentRequest === requestId) {
      rows.innerHTML = '<tr><td colspan="4" class="px-5 py-8 text-center text-salmon-50">Could not load talent. Please try again.</td></tr>';
      toast(error.message, 'error');
    }
  }
}

let searchTimer;
search.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadTalent, 180);
});
streamFilter.addEventListener('change', loadTalent);
stageFilter.addEventListener('change', loadTalent);
await loadTalent();
