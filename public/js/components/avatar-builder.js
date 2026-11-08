// Avatar studio (v2): professional DiceBear art in two styles + curated looks. Cammy wears the result.
import { api } from '../api.js';
import { esc, toast, setBusy, reduceMotion } from '../ui.js';
import { icon } from '../icons.js';
import { renderAvatar, setAvatarState, STATES } from './avatar.js';

const TABS = [['style', 'Style', 'sparkle'], ['face', 'Face', 'smile'], ['hair', 'Hair & headwear', 'wave'], ['outfit', 'Outfit', 'hanger'], ['extras', 'Extras', 'crown']];
const STATE_NAMES = { idle: 'Idle', listening: 'Listening', thinking: 'Thinking', talking: 'Talking', celebrating: 'Celebrating', concerned: 'Concerned', sleeping: 'Sleeping' };
const HEADWEAR = ['hijab', 'turban', 'winterHat1', 'winterHat02', 'winterHat03', 'winterHat04', 'hat'];

export async function createAvatarBuilder(root, { initial, onSaved, saveLabel = 'Save avatar' } = {}) {
  const [cat, prog] = await Promise.all([api('/avatar/catalog'), api('/me/progress').catch(() => ({ badges: [] }))]);
  const badgeName = Object.fromEntries(prog.badges.map((b) => [b.key, b.name]));
  let cfg = { ...initial, v: 2 };
  let tab = 'style';
  let previewState = 'idle';
  const art = () => cat.arts[cfg.art];

  root.innerHTML = `
    <div class="grid gap-6 lg:grid-cols-[19rem_1fr]">
      <div class="space-y-3">
        <div class="relative mx-auto aspect-square w-full max-w-[19rem] overflow-hidden rounded-3xl border border-white/15 shadow-2xl" data-preview></div>
        <div>
          <p class="mb-1.5 text-xs font-medium text-white/60">Preview Cammy's moods</p>
          <div class="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Preview mood" data-states>
            ${STATES.map((s) => `<button type="button" role="radio" aria-checked="${s === previewState}" data-mood="${s}" class="chip aria-checked:!border-salmon aria-checked:!bg-salmon/20 aria-checked:!text-white">${STATE_NAMES[s]}</button>`).join('')}
          </div>
        </div>
        <div class="flex gap-2">
          <button type="button" class="btn btn-ghost flex-1" data-random>${icon('shuffle', 'h-4 w-4')}Randomise</button>
          <button type="button" class="btn btn-ghost" data-reset title="Back to Everyday">${icon('undo', 'h-4 w-4')}Reset</button>
        </div>
        <p class="text-[0.7rem] text-white/40" data-credit></p>
      </div>
      <div class="min-w-0">
        <div class="flex gap-1 overflow-x-auto rounded-2xl border border-white/10 bg-white/5 p-1" role="tablist" aria-label="Avatar options">
          ${TABS.map(([k, l, ic]) => `<button type="button" role="tab" id="tab-${k}" aria-controls="tabpanel" aria-selected="${k === tab}" data-tab="${k}" class="flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium text-white/60 transition hover:text-white aria-selected:bg-gradient-to-r aria-selected:from-purple aria-selected:to-salmon aria-selected:text-snow">${icon(ic, 'h-4 w-4')}${l}</button>`).join('')}
        </div>
        <div id="tabpanel" role="tabpanel" aria-labelledby="tab-style" class="mt-4 min-h-[22rem]" data-panel></div>
        <div class="mt-5 flex justify-end"><button type="button" class="btn btn-primary btn-shine" data-save>${esc(saveLabel)}</button></div>
      </div>
    </div>`;

  const $ = (s) => root.querySelector(s);
  const preview = () => {
    $('[data-preview]').innerHTML = renderAvatar(cfg, { state: previewState, label: 'Your avatar preview', live: true });
    $('[data-credit]').textContent = `Art: ${art().credit}.`;
  };

  const lockNote = (i) => (i.locked ? `<span class="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-2xl bg-ink/75 text-center text-[0.65rem] text-white/85 backdrop-blur-[2px]">${icon('lock', 'h-4 w-4')}<span class="px-1">Earn “${esc(badgeName[i.unlock] || 'a badge')}”</span></span>` : '');
  const card = (field, i, sample, crop = 'head') => `
    <button type="button" data-field="${field}" data-pick="${esc(i.key)}" aria-pressed="${cfg[field] === i.key}" ${i.locked ? 'aria-disabled="true"' : ''}
      class="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] p-1.5 text-left transition hover:-translate-y-0.5 hover:border-white/30 aria-pressed:border-salmon aria-pressed:bg-salmon/10 aria-pressed:shadow-lg aria-pressed:shadow-salmon/20">
      <span class="block aspect-square overflow-hidden rounded-xl">${renderAvatar(sample, { crop, animated: false, label: i.name })}</span>
      <span class="mt-1 block truncate px-0.5 text-xs font-medium">${esc(i.name)}</span>${lockNote(i)}
    </button>`;
  const grid = (cls, html) => `<div class="grid gap-2 ${cls}">${html}</div>`;
  const swatches = (field, colors, label) => `
    <fieldset><legend class="field-label">${label}</legend><div class="flex flex-wrap gap-2">
      ${colors.map((hex) => `<button type="button" data-swatch="${field}" data-value="${hex}" aria-pressed="${cfg[field] === hex}" aria-label="${label} #${hex}"
        class="h-9 w-9 rounded-full border-2 border-white/20 shadow transition hover:scale-110 aria-pressed:scale-110 aria-pressed:border-salmon aria-pressed:ring-4 aria-pressed:ring-salmon/30" style="background:#${hex}"></button>`).join('')}
    </div></fieldset>`;

  function panel() {
    const a = art();
    let html = '';
    if (tab === 'style') {
      html = `
        <fieldset><legend class="field-label">Art style</legend>
          <div class="grid gap-3 sm:grid-cols-2">${Object.entries(cat.arts).map(([k, v]) => {
            const sample = { ...cfg, ...cat.lookPresets[k][cfg.look], art: k, hair: k === 'polished' ? 'sideComed' : 'fro', rearHair: 'shoulderHigh', facialHair: 'none', skin: v.skin[2], hairColor: v.hairColor[0] };
            return `<button type="button" data-art="${k}" aria-pressed="${cfg.art === k}" class="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-left transition hover:-translate-y-0.5 hover:border-white/30 aria-pressed:border-salmon aria-pressed:bg-salmon/10">
              <span class="h-20 w-20 shrink-0 overflow-hidden rounded-xl">${renderAvatar(sample, { animated: false, label: v.name })}</span>
              <span><span class="block font-display font-semibold">${esc(v.name)}</span><span class="block text-xs text-white/55">${k === 'classic' ? 'Widest range of hair textures and headwear, including afros, locs, hijab and turban.' : 'Shaded, natural-looking faces.'}</span></span></button>`;
          }).join('')}</div>
        </fieldset>
        <fieldset class="mt-5"><legend class="field-label">Look</legend>
          <div class="grid gap-3 sm:grid-cols-2">${cat.looks.map((l) => {
            const sample = { ...cfg, look: l.key, ...cat.lookPresets[cfg.art][l.key] };
            return `<button type="button" data-look="${l.key}" aria-pressed="${cfg.look === l.key}" class="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-left transition hover:-translate-y-0.5 hover:border-white/30 aria-pressed:border-salmon aria-pressed:bg-salmon/10">
              <span class="h-16 w-16 shrink-0 overflow-hidden rounded-xl">${renderAvatar(sample, { animated: false, label: l.name })}</span>
              <span><span class="block font-semibold">${esc(l.name)}</span><span class="block text-xs text-white/55">${esc(l.description)}</span></span></button>`;
          }).join('')}</div>
          <p class="mt-3 text-xs text-white/45">Looks set your outfit, colours, accessories and backdrop. You can change any of them afterwards.</p>
        </fieldset>`;
    }
    if (tab === 'face') {
      html = `<div class="space-y-5">${swatches('skin', a.skin, 'Skin tone')}
        <fieldset><legend class="field-label">Facial hair</legend>${grid('grid-cols-3 sm:grid-cols-6', a.facialHair.map((i) => card('facialHair', i, { ...cfg, facialHair: i.key })).join(''))}</fieldset></div>`;
    }
    if (tab === 'hair') {
      const showHat = cfg.art === 'classic' && HEADWEAR.includes(cfg.hair);
      html = `<div class="space-y-5">
        <fieldset><legend class="field-label">${cfg.art === 'classic' ? 'Hair & headwear' : 'Hair (top)'}</legend>${grid('grid-cols-3 sm:grid-cols-5 lg:grid-cols-6', a.hair.map((i) => card('hair', i, { ...cfg, hair: i.key, accessory: 'none' })).join(''))}</fieldset>
        ${a.rearHair ? `<fieldset><legend class="field-label">Length</legend>${grid('grid-cols-3 sm:grid-cols-5', a.rearHair.map((i) => card('rearHair', i, { ...cfg, rearHair: i.key })).join(''))}</fieldset>` : ''}
        ${swatches('hairColor', a.hairColor, 'Hair colour')}
        ${showHat ? swatches('hatColor', cat.palette, 'Headwear colour') : ''}</div>`;
    }
    if (tab === 'outfit') {
      html = `<div class="space-y-5">
        <fieldset><legend class="field-label">Outfit</legend>${grid('grid-cols-3 sm:grid-cols-5', a.clothing.map((i) => card('clothing', i, { ...cfg, clothing: i.key }, 'bust')).join(''))}</fieldset>
        ${swatches('clothesColor', cat.palette, 'Outfit colour')}
        ${a.graphic && cfg.clothing === 'graphicShirt' ? `<fieldset><legend class="field-label">Tee graphic</legend>${grid('grid-cols-4 sm:grid-cols-8', a.graphic.map((i) => card('graphic', i, { ...cfg, graphic: i.key }, 'bust')).join(''))}</fieldset>` : ''}</div>`;
    }
    if (tab === 'extras') {
      html = `<div class="space-y-5">
        ${a.accessory ? `<fieldset><legend class="field-label">Eyewear</legend>${grid('grid-cols-3 sm:grid-cols-4 lg:grid-cols-8', a.accessory.map((i) => card('accessory', i, { ...cfg, accessory: i.key })).join(''))}</fieldset>
          ${cfg.accessory && cfg.accessory !== 'none' ? swatches('accessoryColor', cat.palette, 'Eyewear colour') : ''}` : '<p class="text-sm text-white/55">Eyewear is available in the Classic art style.</p>'}
        <fieldset><legend class="field-label">Backdrop</legend>${grid('grid-cols-3 sm:grid-cols-4 lg:grid-cols-7', cat.backgrounds.map((i) => card('bg', i, { ...cfg, bg: i.key })).join(''))}</fieldset></div>`;
    }
    const P = $('[data-panel]');
    P.innerHTML = html;
    P.setAttribute('aria-labelledby', `tab-${tab}`);
    if (!reduceMotion()) P.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 250 });
  }

  const pop = () => $('[data-preview]').animate?.([{ transform: 'scale(.97)' }, { transform: 'scale(1)' }], { duration: 220, easing: 'ease-out' });
  const update = (patch) => { cfg = { ...cfg, ...patch }; preview(); panel(); pop(); };

  /** Switching art keeps what translates and resets the rest to valid options. */
  function switchArt(next) {
    const a = cat.arts[next];
    const keep = (list, v, fb) => (list.some((i) => (i.key || i) === v && !i.locked) ? v : fb);
    update({
      art: next,
      ...cat.lookPresets[next][cfg.look],
      skin: a.skin[Math.min(a.skin.length - 1, Math.max(0, cat.arts[cfg.art].skin.indexOf(cfg.skin)))] || a.skin[2],
      hair: keep(a.hair, cfg.hair, next === 'polished' ? 'sideComed' : 'shortCurly'),
      hairColor: keep(a.hairColor, cfg.hairColor, a.hairColor[0]),
      facialHair: keep(a.facialHair, cfg.facialHair, 'none'),
      rearHair: next === 'polished' ? (cfg.rearHair || 'none') : undefined,
    });
  }

  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) { tab = t.dataset.tab; root.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b === t))); panel(); return; }
    const ar = e.target.closest('[data-art]');
    if (ar) { if (ar.dataset.art !== cfg.art) switchArt(ar.dataset.art); return; }
    const lk = e.target.closest('[data-look]');
    if (lk) { update({ look: lk.dataset.look, ...cat.lookPresets[cfg.art][lk.dataset.look] }); return; }
    const sw = e.target.closest('[data-swatch]');
    if (sw) { update({ [sw.dataset.swatch]: sw.dataset.value }); return; }
    const pick = e.target.closest('[data-pick]');
    if (pick) {
      if (pick.getAttribute('aria-disabled') === 'true') { toast('Locked. Earn the badge to unlock this item.', 'error'); return; }
      update({ [pick.dataset.field]: pick.dataset.pick });
      return;
    }
    const mood = e.target.closest('[data-mood]');
    if (mood) {
      previewState = mood.dataset.mood;
      root.querySelectorAll('[data-mood]').forEach((b) => b.setAttribute('aria-checked', String(b === mood)));
      setAvatarState($('[data-preview]'), previewState);
    }
  });

  $('[data-random]').addEventListener('click', () => {
    const rnd = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const open = (list) => list.filter((i) => !i.locked).map((i) => i.key);
    const a = art();
    const look = rnd(cat.looks).key;
    update({
      look, ...cat.lookPresets[cfg.art][look],
      skin: rnd(a.skin), hair: rnd(open(a.hair)), hairColor: rnd(a.hairColor), facialHair: Math.random() < 0.7 ? 'none' : rnd(open(a.facialHair)),
      clothing: rnd(open(a.clothing)), clothesColor: rnd(cat.palette), hatColor: rnd(cat.palette),
      ...(a.rearHair ? { rearHair: rnd(open(a.rearHair)) } : {}),
      bg: rnd(open(cat.backgrounds)),
    });
  });
  $('[data-reset]').addEventListener('click', () => update({ look: 'plain', ...cat.lookPresets[cfg.art].plain }));

  $('[data-save]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    setBusy(btn, true, 'Saving…');
    try {
      const res = await api('/profile/avatar', { method: 'PUT', body: { avatar: cfg } });
      cfg = res.avatar;
      toast('Avatar saved. Cammy is wearing it now.', 'success');
      document.dispatchEvent(new CustomEvent('cammy:avatar', { detail: res.avatar }));
      document.dispatchEvent(new CustomEvent('cammy:badges', { detail: res.badges || [] }));
      onSaved?.(res.avatar);
    } catch (err) { toast(err.message, 'error'); }
    setBusy(btn, false);
  });

  preview();
  panel();
  return { get: () => cfg };
}
