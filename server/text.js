// Input sanitising, tiny moderation hook and word banks for generated names.
import { NAME_MAX, SIGN_MAX } from '../shared/layout.js';

// Deliberately small denylist (obfuscation-tolerant). Public deployments should plug a real moderation
// service into `moderate()` via MODERATION_HOOK — everything players type ends up on billboards and radios.
const DENY = ['fuck', 'shit', 'cunt', 'nigg', 'fagg', 'rape', 'nazi', 'kike', 'retard', 'whore'];
const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i' };

export function normalizeForFilter(s) {
  return s.toLowerCase().replace(/[01345 7@$!]/g, (c) => LEET[c] || '').replace(/[^a-z]/g, '');
}

let hook = null;
export function setModerationHook(fn) { hook = fn; }

export function moderate(text) {
  const n = normalizeForFilter(text);
  for (const w of DENY) if (n.includes(w)) return false;
  if (hook) { try { return hook(text) !== false; } catch { return true; } }
  return true;
}

const CTRL = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g;

export function cleanText(s, max = 120) {
  if (typeof s !== 'string') return '';
  return s.replace(CTRL, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function cleanName(s) {
  let n = cleanText(s, 40).replace(/[^\p{L}\p{N} _.\-']/gu, '').trim().slice(0, NAME_MAX);
  if (n.length < 2) return '';
  if (!moderate(n)) return '';
  return n;
}

export function cleanChat(s) {
  const t = cleanText(s, 140);
  if (!t) return '';
  return moderate(t) ? t : '…';
}

export function cleanSign(s) {
  const t = cleanText(s, SIGN_MAX);
  if (!t) return '';
  return moderate(t) ? t : '';
}

export function pick(arr, rnd = Math.random) { return arr[Math.floor(rnd() * arr.length) % arr.length]; }
export function shuffle(arr, rnd = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function listNames(names) {
  const u = [...new Set(names)];
  if (u.length <= 1) return u[0] || 'someone';
  if (u.length === 2) return `${u[0]} and ${u[1]}`;
  return `${u.slice(0, -1).join(', ')} and ${u[u.length - 1]}`;
}

export const FIRST_NAMES = ['Mara', 'Jonas', 'Ilse', 'Tobias', 'Odette', 'Felix', 'Lorna', 'Anders', 'Petra', 'Quill', 'Rowan', 'Sabine', 'Gideon', 'Tamsin', 'Casimir', 'Yara', 'Lucan', 'Nell', 'Osric', 'Vesna'];
export const LAST_NAMES = ['Hale', 'Voss', 'Thorne', 'Marlow', 'Kessler', 'Adeyemi', 'Quinn', 'Rusk', 'Lindqvist', 'Moreau', 'Baptiste', 'Ferro', 'Calloway', 'Sorel', 'Vance', 'Idris'];
