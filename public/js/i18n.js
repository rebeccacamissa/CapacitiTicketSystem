/**
 * Lightweight i18n. The English text is the key, so anything not yet translated
 * simply shows in English (never a blank or a raw key).
 *
 *   t('Hi {name}', { name })            → translated string with variables
 *   <p data-i18n>My dashboard</p>       → translated by translateDom()
 *   data-i18n-placeholder / data-i18n-label / data-i18n-title → attribute versions
 *
 * Dictionaries live in /js/i18n/<code>.js. Translations were drafted for CAPACITI and
 * should be reviewed by native speakers before production use.
 */
export const LANGS = [
  { code: 'en', name: 'English', native: 'English', speech: 'en-ZA' },
  { code: 'zu', name: 'isiZulu', native: 'isiZulu', speech: 'zu-ZA' },
  { code: 'xh', name: 'isiXhosa', native: 'isiXhosa', speech: 'xh-ZA' },
  { code: 'af', name: 'Afrikaans', native: 'Afrikaans', speech: 'af-ZA' },
  { code: 'nso', name: 'Sepedi', native: 'Sepedi', speech: 'nso-ZA' },
];

let lang = localStorage.getItem('capaciti-lang') || 'en';
if (!LANGS.some((l) => l.code === lang)) lang = 'en';
let dict = {};

export const getLang = () => lang;
export const langInfo = () => LANGS.find((l) => l.code === lang);

export async function loadLanguage(code = lang) {
  lang = LANGS.some((l) => l.code === code) ? code : 'en';
  localStorage.setItem('capaciti-lang', lang);
  document.documentElement.lang = lang === 'nso' ? 'nso' : lang;
  dict = lang === 'en' ? {} : (await import(`./i18n/${lang}.js`)).default;
  watch();
  return lang;
}

export function t(text, vars) {
  let s = dict[text] ?? text;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
  return s;
}

// ---------------------------------------------------------------------------
// Automatic translation of rendered UI: any text node or label attribute whose
// whole text is a dictionary key is translated — including content rendered later
// (a MutationObserver keeps watching). User content is protected with translate="no".
// ---------------------------------------------------------------------------
const ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'KBD']);
let mutating = false;

function translateText(node) {
  const raw = node.nodeValue;
  const key = raw.trim().replace(/\s+/g, ' ');
  if (key && dict[key] && dict[key] !== key) node.nodeValue = raw.replace(raw.trim(), dict[key]);
}
function translateEl(el) {
  for (const a of ATTRS) {
    const v = el.getAttribute?.(a);
    if (v && dict[v]) el.setAttribute(a, dict[v]);
  }
}
export function translateDom(root = document.body) {
  if (lang === 'en' || !root) return;
  mutating = true;
  try {
    if (root.nodeType === 3) { if (!root.parentElement?.closest('[translate="no"]')) translateText(root); return; }
    if (root.nodeType !== 1 && root !== document) return;
    const start = root === document ? document.body : root;
    if (start.closest?.('[translate="no"]')) return;
    translateEl(start);
    const walker = document.createTreeWalker(start, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeType === 1 && (SKIP.has(n.tagName) || n.getAttribute('translate') === 'no') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.nodeType === 3) translateText(n); else translateEl(n);
    }
  } finally { mutating = false; }
}

let watching = false;
function watch() {
  if (lang === 'en' || watching) return;
  watching = true;
  const run = () => {
    translateDom(document.body);
    new MutationObserver((records) => {
      if (mutating) return;
      for (const r of records) {
        if (r.type === 'characterData') translateDom(r.target);
        else if (r.type === 'attributes') { mutating = true; translateEl(r.target); mutating = false; }
        else r.addedNodes.forEach((n) => translateDom(n));
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  };
  if (document.body) run(); else addEventListener('DOMContentLoaded', run);
}

/** Switch language: persist, tell the server, and reload so every view re-renders. */
export async function setLanguage(code, { persist = true } = {}) {
  localStorage.setItem('capaciti-lang', code);
  if (persist) {
    try { await fetch('/api/profile/language', { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language: code }) }); } catch { /* signed out */ }
  }
  location.reload();
}

await loadLanguage(lang);
