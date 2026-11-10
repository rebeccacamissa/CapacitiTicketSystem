'use strict';
/**
 * Tiny declarative validator. Schema shape:
 *   { field: { type: 'string'|'int'|'bool'|'enum', required, min, max, values, trim, pattern } }
 * Validated, coerced values replace req[source].
 */
const { badRequest } = require('../utils/AppError');

function validateValue(name, rule, raw) {
  if (raw === undefined || raw === null || raw === '') {
    if (rule.required) return { error: `${name} is required` };
    return { value: rule.default };
  }
  switch (rule.type) {
    case 'string': {
      if (typeof raw !== 'string') return { error: `${name} must be text` };
      const v = rule.trim === false ? raw : raw.trim();
      if (rule.required && !v) return { error: `${name} is required` };
      if (rule.min && v.length < rule.min) return { error: `${name} must be at least ${rule.min} characters` };
      if (rule.max && v.length > rule.max) return { error: `${name} must be at most ${rule.max} characters` };
      if (rule.pattern && !rule.pattern.test(v)) return { error: rule.patternMessage || `${name} is invalid` };
      return { value: v };
    }
    case 'int': {
      const n = Number(raw);
      if (!Number.isInteger(n)) return { error: `${name} must be a whole number` };
      if (rule.min !== undefined && n < rule.min) return { error: `${name} must be ≥ ${rule.min}` };
      if (rule.max !== undefined && n > rule.max) return { error: `${name} must be ≤ ${rule.max}` };
      return { value: n };
    }
    case 'bool': {
      if (raw === true || raw === 'true' || raw === 1 || raw === '1') return { value: true };
      if (raw === false || raw === 'false' || raw === 0 || raw === '0') return { value: false };
      return { error: `${name} must be true or false` };
    }
    case 'enum': {
      if (!rule.values.includes(raw)) return { error: `${name} must be one of: ${rule.values.join(', ')}` };
      return { value: raw };
    }
    case 'array': {
      // { type: 'array', of: 'int' | 'string', min, max (items), itemMax (string length) }
      if (!Array.isArray(raw)) return { error: `${name} must be a list` };
      if (rule.min && raw.length < rule.min) return { error: `Choose at least ${rule.min}` };
      if (rule.max && raw.length > rule.max) return { error: `Choose at most ${rule.max}` };
      if (rule.of === 'int' && raw.some((x) => !Number.isInteger(x) || x < 1)) return { error: `${name} must be a list of ids` };
      if (rule.of === 'string' && raw.some((x) => typeof x !== 'string' || (rule.itemMax && x.length > rule.itemMax))) return { error: `${name} must be a list of text values` };
      return { value: raw };
    }
    default:
      return { value: raw };
  }
}

function validate(schema, source = 'body') {
  return (req, res, next) => {
    const input = req[source] || {};
    const out = {};
    const errors = {};
    for (const [name, rule] of Object.entries(schema)) {
      const { value, error } = validateValue(rule.label || name, rule, input[name]);
      if (error) errors[name] = error;
      else if (value !== undefined) out[name] = value;
    }
    if (Object.keys(errors).length) {
      return next(badRequest('Please correct the highlighted fields', { fields: errors }));
    }
    if (source === 'query') req.validQuery = out;
    else req[source] = out;
    next();
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,72}$/;

/** Date of birth: real calendar date, age 15–100. */
const DOB_RULE = {
  type: 'string', max: 10, label: 'Date of birth',
  pattern: {
    test(v) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
      const d = new Date(`${v}T00:00:00Z`);
      if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return false;
      const age = (Date.now() - d.getTime()) / (365.25 * 86_400_000);
      return age >= 15 && age <= 100;
    },
  },
  patternMessage: 'Enter a valid date of birth (age 15–100)',
};

const NAME_RULE = (label) => ({ type: 'string', required: true, min: 1, max: 60, label,
  pattern: /^[\p{L}][\p{L}' .-]*$/u, patternMessage: `${label} can only contain letters, spaces, apostrophes and hyphens` });

module.exports = { validate, EMAIL_RE, PASSWORD_RE, DOB_RULE, NAME_RULE };
