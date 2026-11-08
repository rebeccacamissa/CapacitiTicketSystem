'use strict';
/**
 * Server-side avatar rendering (DiceBear). Deterministic: same design + state = same SVG,
 * so responses are cached forever by the browser and memoised in-process.
 */
const { createAvatar } = require('@dicebear/core');
const { avataaars, toonHead } = require('@dicebear/collection');
const { normalize } = require('./catalog');

// Facial expression per state. "blink", "talkA" and "talkB" are animation frames.
const FACE = {
  classic: {
    idle: { eyes: 'default', eyebrows: 'defaultNatural', mouth: 'smile' },
    blink: { eyes: 'closed', eyebrows: 'defaultNatural', mouth: 'smile' },
    listening: { eyes: 'default', eyebrows: 'raisedExcitedNatural', mouth: 'default' },
    thinking: { eyes: 'side', eyebrows: 'upDownNatural', mouth: 'serious' },
    talkA: { eyes: 'default', eyebrows: 'defaultNatural', mouth: 'default' },
    talkB: { eyes: 'default', eyebrows: 'raisedExcitedNatural', mouth: 'smile' },
    celebrating: { eyes: 'happy', eyebrows: 'raisedExcitedNatural', mouth: 'smile' },
    concerned: { eyes: 'default', eyebrows: 'sadConcernedNatural', mouth: 'concerned' },
    sleeping: { eyes: 'closed', eyebrows: 'defaultNatural', mouth: 'serious' },
  },
  polished: {
    idle: { eyes: 'wide', eyebrows: 'neutral', mouth: 'smile' },
    blink: { eyes: 'humble', eyebrows: 'neutral', mouth: 'smile' },
    listening: { eyes: 'wide', eyebrows: 'raised', mouth: 'smile' },
    thinking: { eyes: 'wink', eyebrows: 'raised', mouth: 'smile' },
    talkA: { eyes: 'wide', eyebrows: 'neutral', mouth: 'agape' },
    talkB: { eyes: 'wide', eyebrows: 'happy', mouth: 'smile' },
    celebrating: { eyes: 'happy', eyebrows: 'happy', mouth: 'laugh' },
    concerned: { eyes: 'wide', eyebrows: 'sad', mouth: 'sad' },
    sleeping: { eyes: 'humble', eyebrows: 'neutral', mouth: 'smile' },
  },
};
const FRAMES = Object.keys(FACE.classic);

function options(cfg, frame) {
  const f = FACE[cfg.art][frame] || FACE[cfg.art].idle;
  if (cfg.art === 'polished') {
    return {
      seed: 'capaciti',
      skinColor: [cfg.skin], hairColor: [cfg.hairColor],
      hair: cfg.hair === 'none' ? ['bun'] : [cfg.hair], hairProbability: cfg.hair === 'none' ? 0 : 100,
      rearHair: cfg.rearHair && cfg.rearHair !== 'none' ? [cfg.rearHair] : ['neckHigh'], rearHairProbability: cfg.rearHair && cfg.rearHair !== 'none' ? 100 : 0,
      beard: cfg.facialHair !== 'none' ? [cfg.facialHair] : ['chin'], beardProbability: cfg.facialHair !== 'none' ? 100 : 0,
      clothes: [cfg.clothing], clothesColor: [cfg.clothesColor],
      eyes: [f.eyes], eyebrows: [f.eyebrows], mouth: [f.mouth],
    };
  }
  return {
    seed: 'capaciti', style: ['default'],
    skinColor: [cfg.skin], top: [cfg.hair], topProbability: 100, hairColor: [cfg.hairColor], hatColor: [cfg.hatColor],
    facialHair: cfg.facialHair !== 'none' ? [cfg.facialHair] : ['beardLight'], facialHairProbability: cfg.facialHair !== 'none' ? 100 : 0, facialHairColor: [cfg.hairColor],
    clothing: [cfg.clothing], clothesColor: [cfg.clothesColor], clothingGraphic: [cfg.graphic || 'diamond'],
    accessories: cfg.accessory && cfg.accessory !== 'none' ? [cfg.accessory] : ['round'], accessoriesProbability: cfg.accessory && cfg.accessory !== 'none' ? 100 : 0,
    accessoriesColor: [cfg.accessoryColor || '262e33'],
    eyes: [f.eyes], eyebrows: [f.eyebrows], mouth: [f.mouth],
  };
}

const cache = new Map();
const MAX = 4000;

function renderSvg(rawCfg, frame = 'idle') {
  const cfg = normalize(rawCfg);
  const fr = FRAMES.includes(frame) ? frame : 'idle';
  const key = `${JSON.stringify(cfg)}|${fr}`;
  let svg = cache.get(key);
  if (!svg) {
    svg = createAvatar(cfg.art === 'polished' ? toonHead : avataaars, options(cfg, fr)).toString();
    if (cache.size >= MAX) cache.delete(cache.keys().next().value);
    cache.set(key, svg);
  }
  return svg;
}

module.exports = { renderSvg, FRAMES };
