'use strict';
/**
 * Server-side translations (Cammy's replies). English text is the key; missing
 * entries fall back to English. Drafted for CAPACITI — native-speaker review pending.
 */
const DICTS = {
  zu: require('./zu'),
  xh: require('./xh'),
  af: require('./af'),
  nso: require('./nso'),
};

function tr(lang, text, vars) {
  let s = (DICTS[lang] && DICTS[lang][text]) || text;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
  return s;
}

module.exports = { tr, LANGS: ['en', ...Object.keys(DICTS)] };
