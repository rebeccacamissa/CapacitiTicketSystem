// Accessibility needs (labels mirror server/config/accessibility.js)
export const NEEDS = [
  ['screen_reader', 'I use a screen reader'],
  ['low_vision', 'Low vision'],
  ['colour_blind', 'Colour blindness'],
  ['deaf_hoh', 'Deaf or hard of hearing'],
  ['sasl_interpreter', 'I need a South African Sign Language (SASL) interpreter'],
  ['mobility', 'Limited mobility or dexterity'],
  ['cognitive', 'Learning difference (e.g. dyslexia, ADHD)'],
  ['mental_health', 'Mental health condition'],
  ['extra_time', 'I need extra time for assessments'],
  ['chronic_illness', 'Chronic illness'],
  ['other', 'Other'],
];
export const needLabel = (k) => (NEEDS.find(([key]) => key === k) || [k, k])[1];
