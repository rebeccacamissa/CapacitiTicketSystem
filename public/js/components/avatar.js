/**
 * Avatar renderer (v2). Art is rendered server-side by DiceBear (/api/avatar.svg),
 * so this module just builds <img> stacks.
 *
 *   renderAvatar(cfg, { crop: 'bust'|'head', state, animated, background, label, live })
 *     live: true → preload every expression frame so setAvatarState() can switch instantly
 *     (used by Cammy and the studio preview). Otherwise a single still image.
 *
 * States: idle · listening · thinking · talking · celebrating · concerned · sleeping
 */
export const STATES = ['idle', 'listening', 'thinking', 'talking', 'celebrating', 'concerned', 'sleeping'];
const FRAMES = ['idle', 'blink', 'listening', 'thinking', 'talkA', 'talkB', 'celebrating', 'concerned', 'sleeping'];

export const DEFAULT_AVATAR = {
  v: 2, art: 'classic', look: 'plain', skin: 'ae5d29', hair: 'shortCurly', hairColor: '2c1b18', hatColor: '1d2951', facialHair: 'none',
  clothing: 'shirtCrewNeck', clothesColor: '1d2951', graphic: 'diamond', accessory: 'none', accessoryColor: '262e33', rearHair: 'none', bg: 'aurora',
};

const KEYS = ['v', 'art', 'look', 'skin', 'hair', 'hairColor', 'hatColor', 'facialHair', 'clothing', 'clothesColor', 'graphic', 'accessory', 'accessoryColor', 'rearHair'];
const b64url = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Stable URL for a design + expression frame (key order fixed so caching works). */
export function avatarUrl(cfg, frame = 'idle') {
  const c = { ...DEFAULT_AVATAR, ...(cfg?.v === 2 ? cfg : {}) };
  const ordered = {};
  for (const k of KEYS) if (c[k] !== undefined) ordered[k] = c[k];
  return `/api/avatar.svg?c=${b64url(JSON.stringify(ordered))}&s=${frame}`;
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

function overlays() {
  return `<svg class="av-ov" viewBox="0 0 100 100" aria-hidden="true">
    <g class="v v-ot">${[0, 1, 2].map((i) => `<circle class="av-dot" style="animation-delay:${i * 0.2}s" cx="${72 + i * 8}" cy="${18 - i * 5}" r="${2.6 + i * 0.8}" fill="#fff" stroke="#1d2951" stroke-width=".8"/>`).join('')}</g>
    <g class="v v-oz" fill="#fff" stroke="#1d2951" stroke-width=".6" font-family="Space Grotesk, sans-serif" font-weight="700">${[0, 1, 2].map((i) => `<text class="av-z" style="animation-delay:${i * 0.6}s" x="${70 + i * 7}" y="${30 - i * 9}" font-size="${9 + i * 3}">z</text>`).join('')}</g>
    <g class="v v-oc">${[[12, 22, '#f25251'], [86, 30, '#d4af37'], [16, 70, '#6115d0'], [88, 72, '#f1d1d1'], [50, 8, '#d4af37']].map(([x, y, c], i) => `<path class="av-twinkle" style="animation-delay:${i * 0.15}s" d="M${x} ${y - 5} l1.5 3.5 3.5 1.5 -3.5 1.5 -1.5 3.5 -1.5 -3.5 -3.5 -1.5 3.5 -1.5z" fill="${c}"/>`).join('')}</g>
  </svg>`;
}

export function renderAvatar(cfg, { crop = 'bust', state = 'idle', animated = true, background = true, label = 'Avatar', live = false } = {}) {
  const c = { ...DEFAULT_AVATAR, ...(cfg?.v === 2 ? cfg : {}) };
  const st = STATES.includes(state) ? state : 'idle';
  const frames = live ? FRAMES : [st === 'talking' ? 'talkA' : st];
  const imgs = frames.map((f, i) => `<img src="${avatarUrl(c, f)}" data-f="${f}" alt="" draggable="false" decoding="async" ${live ? '' : 'loading="lazy"'}>`).join('');
  return `<span class="av ${animated ? '' : 'av-static'} ${live ? 'av-live' : ''}" data-state="${st}" data-crop="${crop}" role="img" aria-label="${esc(label)}">
    ${background ? `<span class="av-bg av-bg-${esc(c.bg || 'aurora')}" aria-hidden="true"></span>` : ''}
    <span class="av-stack"><span class="av-crop">${imgs}</span></span>${live ? overlays() : ''}
  </span>`;
}

/** Switch state on a rendered live avatar (or any element containing one). */
export function setAvatarState(el, state) {
  const av = el?.classList?.contains('av') ? el : el?.querySelector?.('.av');
  if (av && STATES.includes(state)) av.dataset.state = state;
}

