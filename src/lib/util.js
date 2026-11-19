import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const p = (...parts) => path.join(ROOT, ...parts);

export const readJSON = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { if (fallback !== undefined) return fallback; throw e; }
};
export const writeJSON = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
};

export const brand = () => readJSON(p('config', 'brand.json'));
/** 'manual' (default) or 'auto'. PUBLISH_MODE env overrides config (used in tests). */
export const publishMode = () => process.env.PUBLISH_MODE || brand().publish_mode || 'manual';
export const engines = () => readJSON(p('config', 'engines.json')).engines;

export const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function env(name, { required = true } = {}) {
  const v = process.env[name];
  if (required && !v) throw new Error(`Missing environment variable ${name}. See README (Nustatymas).`);
  return v;
}

/** fetch with retries and a JSON body helper */
export async function http(url, { method = 'GET', headers = {}, body, json, retries = 2, timeout = 60000 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, {
        method,
        headers: json ? { 'content-type': 'application/json', ...headers } : headers,
        body: json ? JSON.stringify(json) : body,
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (res.status >= 500 || res.status === 429) {
        lastErr = new Error(`${method} ${url.split('?')[0]} -> ${res.status} ${await res.text()}`);
        await sleep(1500 * (i + 1) ** 2);
        continue;
      }
      return res;
    } catch (e) {
      clearTimeout(t);
      lastErr = e;
      await sleep(1500 * (i + 1) ** 2);
    }
  }
  throw lastErr;
}

/** Roman numerals for slide markers */
export function roman(n) {
  const map = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
  return out;
}

export const escapeHtml = (s = '') => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** House style: no em/en dashes, no hashtags, no exclamation marks. Applied to every generated string. */
export function houseStyle(s = '') {
  return String(s)
    .replace(/(\d)\s*[–—]\s*(\d)/g, '$1-$2')      // ranges: 1450–1520 -> 1450-1520
    .replace(/\s+[—–]\s+/g, ', ')                    // spaced dash -> comma
    .replace(/[—–]/g, ', ')                          // any other dash
    .replace(/,\s*,/g, ',')
    .replace(/!/g, '.')
    .replace(/(^|\s)#[\p{L}\d_]+/gu, '$1')           // hashtags
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function deepHouseStyle(obj) {
  if (typeof obj === 'string') return houseStyle(obj);
  if (Array.isArray(obj)) return obj.map(deepHouseStyle);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = (k === 'caption') ? captionStyle(v) : deepHouseStyle(v);
    return out;
  }
  return obj;
}

/** Caption keeps line breaks and URLs. */
function captionStyle(s) {
  return String(s).split('\n').map((line) => (/https?:\/\//.test(line) ? line.trim() : houseStyle(line))).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export const wordCount = (s = '') => String(s).trim().split(/\s+/).filter(Boolean).length;

export function weightedPick(items, rand = Math.random) {
  const total = items.reduce((a, b) => a + (b.weight ?? 1), 0);
  let r = rand() * total;
  for (const it of items) { r -= it.weight ?? 1; if (r <= 0) return it; }
  return items[items.length - 1];
}
