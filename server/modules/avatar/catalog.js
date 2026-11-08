'use strict';
/**
 * Avatar catalogue (v2) — professional open-source art via DiceBear.
 *
 *   art 'classic'  → Avataaars by Pablo Stanley (free for personal & commercial use).
 *                    Most inclusive: afro, locs, frizzle, curls, hijab, turban, beanies.
 *   art 'polished' → toonHead by Johan Melin (CC BY 4.0 — attribution shown in the app).
 *                    Shaded, natural faces.
 *
 * "Looks" (Everyday / Fashion Doll Glam / Tactical Operator / Runway Dress-Up) are
 * curated presets of outfit, colours, accessories and backdrop on top of either art.
 * They are original styling inspired by those aesthetics — no third-party names or art.
 * Commissioned theme artwork can later be added as a third `art` without changing callers.
 *
 * Religious / cultural headwear (hijab, turban) is never locked behind badges.
 */

const PALETTE = ['1d2951', '6115d0', 'f25251', 'f1d1d1', '151613', 'f5f5f4', '4b5320', 'c2a878', '0b3286', 'd4af37', 'be185d', '147f3c', 'ec4899', 'f97316', '545454', '731ac3'];

const ART = {
  classic: {
    name: 'Classic', credit: 'Avataaars by Pablo Stanley',
    skin: ['614335', '7b4a2a', 'ae5d29', 'c68642', 'd08b5b', 'edb98a', 'ffdbb4'],
    hairColor: ['2c1b18', '4a312c', '724133', 'a55728', 'b58143', 'd6b370', 'c93305', 'e8e1e1', 'f59797', '6115d0'],
    hair: [
      ['shortFlat', 'Short flat'], ['shortRound', 'Short round'], ['shortWaved', 'Short waves'], ['shortCurly', 'Short curls'],
      ['theCaesar', 'Caesar'], ['theCaesarAndSidePart', 'Side part'], ['sides', 'Shaved top'], ['shavedSides', 'Shaved sides'],
      ['fro', 'Afro'], ['froBand', 'Afro with band', 'explorer'], ['dreads', 'Short locs'], ['dreads01', 'Locs'], ['dreads02', 'Long locs'],
      ['frizzle', 'Frizzle'], ['curly', 'Curly'], ['curvy', 'Curvy'], ['bigHair', 'Big hair'], ['bob', 'Bob'], ['bun', 'Bun'],
      ['straight01', 'Straight'], ['straight02', 'Long straight'], ['straightAndStrand', 'Straight & strand'], ['longButNotTooLong', 'Shoulder length'],
      ['miaWallace', 'Blunt bob'], ['frida', 'Flower crown'], ['shaggy', 'Shaggy'], ['shaggyMullet', 'Mullet'],
      ['hijab', 'Hijab'], ['turban', 'Turban'], ['winterHat1', 'Beanie'], ['winterHat02', 'Bobble hat'], ['winterHat03', 'Ear-flap hat'],
      ['winterHat04', 'Cat-ear beanie', 'closer'], ['hat', 'Fedora', 'milestone_work_ready'],
    ],
    facialHair: [['none', 'None'], ['beardLight', 'Light beard'], ['beardMedium', 'Beard'], ['beardMajestic', 'Full beard'], ['moustacheFancy', 'Fancy moustache'], ['moustacheMagnum', 'Moustache']],
    clothing: [
      ['shirtCrewNeck', 'Crew neck'], ['shirtVNeck', 'V-neck'], ['shirtScoopNeck', 'Scoop neck'], ['hoodie', 'Hoodie'],
      ['collarAndSweater', 'Collar & sweater'], ['graphicShirt', 'Graphic tee'], ['blazerAndShirt', 'Blazer & shirt'],
      ['blazerAndSweater', 'Blazer & sweater', 'milestone_onboarding'], ['overall', 'Dungarees', 'first_request'],
    ],
    graphic: [['diamond', 'Diamond'], ['bear', 'Bear'], ['deer', 'Deer'], ['skullOutline', 'Skull'], ['bat', 'Bat'], ['pizza', 'Pizza'], ['hola', 'Hola'], ['cumbia', 'Cumbia']],
    accessory: [['none', 'None'], ['prescription01', 'Glasses'], ['prescription02', 'Square glasses'], ['round', 'Round glasses'], ['kurt', 'Retro shades'], ['wayfarers', 'Wayfarers'], ['sunglasses', 'Sunglasses'], ['eyepatch', 'Eye patch', 'milestone_training']],
  },
  polished: {
    name: 'Polished', credit: 'toonHead by Johan Melin (CC BY 4.0)',
    skin: ['5c3829', '7b4a2a', 'a36b4f', 'b98e6a', 'c68e7a', 'e0ac69', 'f1c3a5'],
    hairColor: ['2c1b18', '724133', 'a55728', 'b58143', 'd6b370', 'e8e1e1', 'c93305'],
    hair: [['bun', 'Bun'], ['sideComed', 'Side swept'], ['undercut', 'Undercut'], ['spiky', 'Spiky'], ['none', 'Shaved']],
    rearHair: [['none', 'None'], ['neckHigh', 'Neck length'], ['shoulderHigh', 'Shoulder length'], ['longStraight', 'Long straight'], ['longWavy', 'Long waves']],
    facialHair: [['none', 'None'], ['chin', 'Chin beard'], ['chinMoustache', 'Goatee'], ['fullBeard', 'Full beard'], ['longBeard', 'Long beard'], ['moustacheTwirl', 'Twirled moustache']],
    clothing: [['tShirt', 'T-shirt'], ['shirt', 'Collared shirt'], ['turtleNeck', 'Turtleneck'], ['openJacket', 'Open jacket', 'milestone_onboarding'], ['dress', 'Dress', 'first_request']],
  },
};

const LOOKS = [
  { key: 'plain', name: 'Everyday', description: 'Simple and clean, where everyone starts.' },
  { key: 'doll', name: 'Fashion Doll Glam', description: 'Bold pinks, statement shades, glossy backdrop.' },
  { key: 'tactical', name: 'Tactical Operator', description: 'Olive and khaki, mission-ready gear.' },
  { key: 'runway', name: 'Runway Dress-Up', description: 'Tailored pieces, gold accents, spotlight.' },
];

/** Preset applied when a look is chosen (per art). */
const LOOK_PRESETS = {
  classic: {
    plain: { clothing: 'shirtCrewNeck', clothesColor: '1d2951', accessory: 'none', bg: 'aurora' },
    doll: { clothing: 'shirtScoopNeck', clothesColor: 'ec4899', accessory: 'wayfarers', accessoryColor: 'f1d1d1', bg: 'sunset' },
    tactical: { clothing: 'hoodie', clothesColor: '4b5320', accessory: 'sunglasses', accessoryColor: '151613', bg: 'camo' },
    runway: { clothing: 'blazerAndShirt', clothesColor: '151613', accessory: 'round', accessoryColor: 'd4af37', bg: 'studio' },
  },
  polished: {
    plain: { clothing: 'tShirt', clothesColor: '1d2951', bg: 'aurora' },
    doll: { clothing: 'turtleNeck', clothesColor: 'ec4899', bg: 'sunset' },
    tactical: { clothing: 'shirt', clothesColor: '4b5320', bg: 'camo' },
    runway: { clothing: 'turtleNeck', clothesColor: '151613', bg: 'studio' },
  },
};

const BACKGROUNDS = [['aurora', 'Aurora'], ['sunset', 'Sunset'], ['night', 'Night'], ['studio', 'Studio'], ['camo', 'Camo'], ['ocean', 'Ocean'], ['runway-lights', 'Runway lights', 'feedback']];

const item = ([key, name, unlock]) => ({ key, name, ...(unlock ? { unlock } : {}) });

function defaultAvatar(gender = 'prefer-not') {
  const hair = { female: 'longButNotTooLong', male: 'shortFlat' }[gender] || 'shortCurly';
  return {
    v: 2, art: 'classic', look: 'plain', skin: 'ae5d29', hair, hairColor: '2c1b18', hatColor: '1d2951', facialHair: 'none',
    clothing: 'shirtCrewNeck', clothesColor: '1d2951', graphic: 'diamond', accessory: 'none', accessoryColor: '262e33',
    rearHair: 'none', bg: 'aurora', custom: false,
  };
}

const unlockedFor = (unlock, role, badges) => !unlock || role !== 'candidate' || badges.has(unlock);

/** Strict validation for saving (throws a message string). */
function validate(cfg, { role, badges = new Set() }) {
  if (!cfg || typeof cfg !== 'object') throw 'Avatar design is missing';
  const art = ART[cfg.art];
  if (!art) throw 'Unknown art style';
  if (!LOOKS.some((l) => l.key === cfg.look)) throw 'Unknown look';
  const pick = (list, val, label) => {
    const found = list.find(([k]) => k === val);
    if (!found) throw `Unknown ${label}`;
    if (!unlockedFor(found[2], role, badges)) throw `${found[1]} is locked. Earn the badge to unlock it`;
    return val;
  };
  const color = (list, val, label) => { if (!list.includes(val)) throw `Choose a ${label} from the palette`; return val; };
  const out = {
    v: 2, art: cfg.art, look: cfg.look,
    skin: color(art.skin, cfg.skin, 'skin tone'),
    hair: pick(art.hair, cfg.hair, 'hair style'),
    hairColor: color(art.hairColor, cfg.hairColor, 'hair colour'),
    facialHair: pick(art.facialHair, cfg.facialHair, 'facial hair'),
    clothing: pick(art.clothing, cfg.clothing, 'outfit'),
    clothesColor: color(PALETTE, cfg.clothesColor, 'outfit colour'),
    bg: pick(BACKGROUNDS, cfg.bg, 'backdrop'),
    custom: true,
  };
  if (cfg.art === 'classic') {
    out.hatColor = color(PALETTE, cfg.hatColor || '1d2951', 'headwear colour');
    out.graphic = pick(art.graphic, cfg.graphic || 'diamond', 'graphic');
    out.accessory = pick(art.accessory, cfg.accessory || 'none', 'accessory');
    out.accessoryColor = cfg.accessoryColor === '262e33' ? '262e33' : color(PALETTE, cfg.accessoryColor || '262e33', 'accessory colour');
  } else {
    out.rearHair = pick(art.rearHair, cfg.rearHair || 'none', 'hair length');
  }
  return out;
}

/** Lenient normalisation for rendering: anything unknown falls back to the default. */
function normalize(cfg) {
  const d = defaultAvatar();
  if (!cfg || cfg.v !== 2 || !ART[cfg.art]) return d;
  const art = ART[cfg.art];
  const ok = (list, v, fb) => (list.some((x) => (Array.isArray(x) ? x[0] : x) === v) ? v : fb);
  return {
    ...cfg,
    skin: ok(art.skin, cfg.skin, art.skin[2]),
    hair: ok(art.hair, cfg.hair, art.hair[0][0]),
    hairColor: ok(art.hairColor, cfg.hairColor, art.hairColor[0]),
    facialHair: ok(art.facialHair, cfg.facialHair, 'none'),
    clothing: ok(art.clothing, cfg.clothing, art.clothing[0][0]),
    clothesColor: ok(PALETTE, cfg.clothesColor, '1d2951'),
    hatColor: ok(PALETTE, cfg.hatColor, '1d2951'),
    graphic: art.graphic ? ok(art.graphic, cfg.graphic, 'diamond') : undefined,
    accessory: art.accessory ? ok(art.accessory, cfg.accessory, 'none') : undefined,
    accessoryColor: /^[0-9a-f]{6}$/.test(cfg.accessoryColor || '') ? cfg.accessoryColor : '262e33',
    rearHair: art.rearHair ? ok(art.rearHair, cfg.rearHair, 'none') : undefined,
    bg: ok(BACKGROUNDS, cfg.bg, 'aurora'),
  };
}

function avatarOf(row) {
  if (row.avatar_config) {
    try {
      const cfg = JSON.parse(row.avatar_config);
      if (cfg?.v === 2) return cfg;
    } catch { /* fall through */ }
  }
  return defaultAvatar(row.gender);
}

function catalog(role, badges) {
  const mark = (list) => list.map(item).map((i) => ({ ...i, locked: !unlockedFor(i.unlock, role, badges) }));
  const arts = {};
  for (const [key, a] of Object.entries(ART)) {
    arts[key] = {
      name: a.name, credit: a.credit, skin: a.skin, hairColor: a.hairColor,
      hair: mark(a.hair), facialHair: mark(a.facialHair), clothing: mark(a.clothing),
      ...(a.graphic ? { graphic: mark(a.graphic) } : {}),
      ...(a.accessory ? { accessory: mark(a.accessory) } : {}),
      ...(a.rearHair ? { rearHair: mark(a.rearHair) } : {}),
    };
  }
  return { arts, looks: LOOKS, lookPresets: LOOK_PRESETS, palette: PALETTE, backgrounds: mark(BACKGROUNDS) };
}

module.exports = { defaultAvatar, validate, normalize, avatarOf, catalog, ART };
