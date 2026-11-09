import { api } from '../api.js';
import { initPage } from '../layout.js';
import { icon } from '../icons.js';

await initPage({ roles: ['recruiter'] });
const data = await api('/recruiter/summary');
const metrics = [
  ['Visible Profiles', data.visibleProfiles, 'users'],
  ['Work Ready Candidates', data.workReadyCandidates, 'check'],
  ['Placed Candidates', data.placedCandidates, 'flag'],
  ['Active Streams', data.activeStreams, 'chart'],
];
document.getElementById('recruiter-kpis').innerHTML = metrics.map(([label, count, symbol]) => `
  <article class="card">
    <p class="flex items-center gap-2 text-sm text-white/60">${icon(symbol, 'h-4 w-4 text-salmon-50')}${label}</p>
    <p class="mt-3 font-display text-4xl font-semibold tabular-nums">${count}</p>
  </article>`).join('');
