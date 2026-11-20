import fs from 'node:fs';
import path from 'node:path';
import { brand, http, log } from './lib/util.js';
import { callTool } from './lib/claude.js';

/**
 * Backgrounds that are on-topic AND beautiful.
 *
 * 1. The writer chooses a visual style for the whole post (paintings or photographs) and a
 *    topical query per slide ("Canaletto Grand Canal", "Roman Forum ruins at dawn").
 * 2. Candidates come from licensed sources only:
 *      paintings  Art Institute of Chicago + The Met, public domain (CC0) works only
 *      photos     Unsplash (free licence, commercial use allowed, photographer credited)
 * 3. A Claude "art director" looks at the thumbnails and picks the one that fits the topic and
 *    reads as calm, minimal, high quality. If none fits, it says so and we search wider.
 */

const UA = { 'AIC-User-Agent': 'history-uncle-autopilot (historyuncle.substack.com)', 'user-agent': 'history-uncle-autopilot' };
const AVOID = /\b(nude|naked|bath(er|ers|sheba)?|venus|leda|danae|susanna|martyrdom|massacre|beheading|judith|holofernes|crucifixion|flaying|slaughter|corpse|dead christ|lamentation|rape)\b/i;
const PER_QUERY = 10;

/* ---------- sources ---------- */

async function searchAIC(q) {
  const params = new URLSearchParams({
    q, 'query[term][is_public_domain]': 'true', limit: '40',
    fields: 'id,title,artist_title,date_display,image_id,thumbnail,artwork_type_title',
  });
  const res = await http(`https://api.artic.edu/api/v1/artworks/search?${params}`, { headers: UA, retries: 1 });
  if (!res.ok) return [];
  return ((await res.json()).data ?? [])
    .filter((a) => a.image_id && a.artwork_type_title === 'Painting' && !AVOID.test(a.title ?? ''))
    .map((a) => ({
      key: `aic:${a.id}`, kind: 'painting',
      thumb: `https://www.artic.edu/iiif/2/${a.image_id}/full/400,/0/default.jpg`,
      url: `https://www.artic.edu/iiif/2/${a.image_id}/full/1686,/0/default.jpg`,
      title: a.title, artist: a.artist_title || 'Unknown artist', date: a.date_display || '',
      source: 'Art Institute of Chicago',
      w: a.thumbnail?.width, h: a.thumbnail?.height,
    }));
}

async function searchMet(q) {
  const params = new URLSearchParams({ q, hasImages: 'true', medium: 'Paintings' });
  const res = await http(`https://collectionapi.metmuseum.org/public/collection/v1/search?${params}`, { headers: UA, retries: 1 });
  if (!res.ok) return [];
  const ids = ((await res.json()).objectIDs ?? []).slice(0, 20);
  const out = [];
  for (const id of ids) {
    const r = await http(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`, { headers: UA, retries: 0 }).catch(() => null);
    if (!r?.ok) continue;
    const o = await r.json();
    if (!o.isPublicDomain || !o.primaryImage || AVOID.test(o.title ?? '')) continue;
    out.push({
      key: `met:${o.objectID}`, kind: 'painting',
      thumb: o.primaryImageSmall || o.primaryImage, url: o.primaryImage,
      title: o.title, artist: o.artistDisplayName || 'Unknown artist', date: o.objectDate || '',
      source: 'The Metropolitan Museum of Art',
    });
    if (out.length >= 6) break;
  }
  return out;
}

const stripHtml = (h = '') => String(h).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

/** Wikimedia metadata often carries Wikidata template residue ("title QS:P1476,...") and several languages. */
export function cleanTitle(raw = '') {
  let t = stripHtml(raw).split(/\s*(?:title|label|date)?\s*QS:/)[0];
  const en = t.match(/English:\s*(.+?)(?=\s+[A-Z][a-z]+:\s|$)/);
  t = en ? en[1] : t.replace(/^[A-Z][a-zé]+:\s*/, '');
  return t.replace(/^["'\s]+|["'\s,]+$/g, '').slice(0, 90);
}
export function cleanArtist(raw = '') {
  let a = stripHtml(raw).split(/\s*QS:/)[0].trim();
  const half = a.length / 2;
  if (Number.isInteger(half) && a.slice(0, half) === a.slice(half)) a = a.slice(0, half);
  return a.replace(/\s*\(.*$/, '').slice(0, 60);
}
export function cleanDate(raw = '') {
  const m = stripHtml(raw).match(/(c\.\s*)?\b\d{3,4}(\s*[–-]\s*\d{2,4})?/);
  return m ? m[0].replace(/–/g, '-') : '';
}
// Public domain / CC0 always; plain CC BY with attribution. Share-alike and non-commercial are skipped.
const OK_LICENSE = (l = '') => /public domain|^pd|cc0/i.test(l) || (/^cc by(\s|-)\d/i.test(l) && !/sa|nc|nd/i.test(l));

async function searchCommons(q, kind) {
  const params = new URLSearchParams({
    action: 'query', format: 'json', origin: '*', generator: 'search',
    gsrsearch: `${q} filetype:bitmap`, gsrnamespace: '6', gsrlimit: '30',
    prop: 'imageinfo', iiprop: 'url|extmetadata|size', iiurlwidth: '1600',
  });
  const res = await http(`https://commons.wikimedia.org/w/api.php?${params}`, { headers: UA, retries: 1 });
  if (!res.ok) return [];
  const pages = Object.values((await res.json()).query?.pages ?? {}).sort((a, b) => a.index - b.index);
  return pages.map((pg) => {
    const ii = pg.imageinfo?.[0]; if (!ii) return null;
    const m = ii.extmetadata ?? {};
    const license = m.LicenseShortName?.value ?? '';
    const title = cleanTitle(m.ObjectName?.value) || pg.title.replace(/^File:/, '').replace(/\.[a-z]+$/i, '').replace(/\s*-\s*Google Art Project.*$/i, '');
    if (!OK_LICENSE(license) || ii.width < 1000 || AVOID.test(title)) return null;
    const thumb = ii.thumburl?.replace(/\/1600px-/, '/400px-') ?? ii.thumburl;
    return {
      key: `commons:${pg.pageid}`, kind,
      thumb, url: ii.thumburl || ii.url,
      title, artist: cleanArtist(m.Artist?.value) || 'Unknown artist',
      date: cleanDate(m.DateTimeOriginal?.value), license,
      source: 'Wikimedia Commons', w: ii.width, h: ii.height,
    };
  }).filter(Boolean);
}

async function searchUnsplash(q) {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) return [];
  const params = new URLSearchParams({ query: q, orientation: 'portrait', per_page: '20', content_filter: 'high' });
  const res = await http(`https://api.unsplash.com/search/photos?${params}`, { headers: { Authorization: `Client-ID ${key}`, 'Accept-Version': 'v1' }, retries: 1 });
  if (!res.ok) return [];
  return ((await res.json()).results ?? []).map((ph) => ({
    key: `unsplash:${ph.id}`, kind: 'photo',
    thumb: `${ph.urls.raw}&w=400&fm=jpg&q=70`,
    url: `${ph.urls.raw}&w=1600&fm=jpg&q=85`,
    downloadLocation: ph.links?.download_location,
    title: ph.alt_description || ph.description || '', artist: `Photo by ${ph.user?.name ?? 'Unknown'}`, date: '',
    source: 'Unsplash', w: ph.width, h: ph.height,
  }));
}

async function gather(query, style, used) {
  const lists = style === 'photo'
    ? await Promise.all([searchUnsplash(query).catch(() => []), searchCommons(query, 'photo').catch(() => [])])
    : await Promise.all([searchCommons(query, 'painting').catch(() => []), searchAIC(query).catch(() => []), searchMet(query).catch(() => [])]);
  // interleave sources so the art director sees variety
  const seen = new Set(); const out = [];
  for (let i = 0; out.length < PER_QUERY && lists.some((l) => l[i]); i++) {
    for (const l of lists) { const c = l[i]; if (c && !used.has(c.key) && !seen.has(c.key)) { seen.add(c.key); out.push(c); } }
  }
  return out.slice(0, PER_QUERY);
}

/* ---------- art director ---------- */

const PICK_TOOL = {
  name: 'pick',
  description: 'Choose the best background, or -1 if none is good enough.',
  input_schema: {
    type: 'object', required: ['index', 'reason', 'fit', 'focus_x', 'focus_y'],
    properties: {
      index: { type: 'integer' },
      reason: { type: 'string' },
      fit: { type: 'string', enum: ['fill', 'frame'], description: 'fill = crop to fill the 4:5 slide; frame = show the whole work uncropped above the text.' },
      focus_x: { type: 'number', description: '0 (left) to 1 (right): horizontal centre of the part that must stay visible when filling.' },
      focus_y: { type: 'number', description: '0 (top) to 1 (bottom): vertical centre of the part that must stay visible when filling.' },
    },
  },
};

const DIRECTOR = `You are the art director of History Uncle, a history brand whose Instagram carousels must look like a calm, expensive editorial: classical paintings and refined photographs with white serif text set over the lower third.

Choose ONE background for the slide. Criteria, in order:
1. On topic for THIS slide: it should show what the slide is actually about, the person it names, the place, the object, the text or the event. A portrait of the jurist the slide quotes beats a generic Roman ruin; the actual manuscript beats any old book. If nothing shows the exact subject, the closest thing from the same person, place and period is acceptable. A generic mood image is a last resort.
2. Aesthetic: minimal and calm composition, strong mood, good light, negative space, high image quality. Avoid clutter, busy crowds, kitsch, text, watermarks, frames, low resolution, modern objects in a historical post.
3. Works with white text in the lower third: the lower part should be quiet rather than full of detail.
4. Aesthetic bar: think of the best curated history and art accounts. Prefer one clear subject, strong light, rich but calm colour, high resolution, no visible frames, captions, colour charts, museum walls or watermarks.
5. Format: the slide is a vertical 4:5 frame. Each candidate lists its size and shape. Prefer portrait or square works. A wide landscape loses most of its width when cropped to 4:5, so pick one only if it is clearly the best fit for the topic, and then choose fit "frame" so the whole painting shows uncropped. Use fit "fill" for portrait and square works and for wide images whose subject sits in a narrow central area. Set focus_x and focus_y on the face, figure, ship or building that must stay in view; text covers the bottom 40% of a "fill" slide, so a face in the lower half is a poor choice.
Never pick anything violent, graphic or sexual.
Return -1 only if every candidate is plainly unrelated or poor quality.`;

async function fetchB64(url) {
  const res = await http(url, { headers: UA, retries: 0, timeout: 20000 });
  if (!res.ok) throw new Error(String(res.status));
  return Buffer.from(await res.arrayBuffer()).toString('base64');
}

const clamp01 = (v, d) => (typeof v === 'number' && v >= 0 && v <= 1 ? v : d);

/** Without an art director: frame wide images, fill the rest. */
export const defaultFit = (c) => (c.w && c.h && c.w / c.h > 1.3 ? 'frame' : 'fill');

async function direct(cands, ctx, lenient = false) {
  if (!process.env.ANTHROPIC_API_KEY || cands.length === 0) return cands[0] ? { ...cands[0], fit: defaultFit(cands[0]) } : null;
  const note = lenient ? '\n\nThis is the last attempt: pick the best available candidate that is not off-putting, even if it is only loosely on topic. Return -1 only if all are unusable.' : '';
  const content = [{ type: 'text', text: `Post: ${ctx.title}\nSlide: ${ctx.text}\nVisual search used: ${ctx.query}${note}\n\nCandidates:` }];
  const shown = [];
  for (const c of cands) {
    const b64 = await fetchB64(c.thumb).catch(() => null);
    if (!b64) continue;
    const shape = c.w && c.h ? `, ${c.w}x${c.h} (${c.w / c.h > 1.25 ? 'wide' : c.h / c.w > 1.1 ? 'portrait' : 'square-ish'})` : '';
    content.push({ type: 'text', text: `[${shown.length}] ${c.artist}${c.title ? `, ${c.title}` : ''}${c.date ? `, ${c.date}` : ''}${shape}` });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } });
    shown.push(c);
  }
  if (!shown.length) return null;
  const { index, reason, fit, focus_x: fx, focus_y: fy } = await callTool({ model: brand().model.curator, system: DIRECTOR, user: content, tool: PICK_TOOL, maxTokens: 500 });
  log(`art director: ${index} ${fit ?? ''} (${reason})`);
  const c = shown[index];
  return c ? { ...c, fit, focus: [clamp01(fx, 0.5), clamp01(fy, 0.35)] } : null;
}

/* ---------- public ---------- */

export async function findArt(ctx, style, used) {
  const other = style === 'photo' ? 'painting' : (process.env.UNSPLASH_ACCESS_KEY ? 'photo' : 'painting');
  const queries = [...new Set([ctx.query, ...(ctx.fallbacks ?? [])].filter(Boolean))];
  const uniq = (list) => [...new Map(list.map((c) => [c.key, c])).values()];
  const seen = [];
  const attempt = async (searches, max, lenient = false) => {
    const lists = await Promise.all(searches.map(({ q, st }) => gather(q, st, used).catch(() => [])));
    // interleave so the director sees the best of every search
    const pool = [];
    for (let i = 0; pool.length < max && lists.some((l) => l[i]); i++) for (const l of lists) if (l[i]) pool.push(l[i]);
    const cands = uniq(pool).slice(0, max);
    seen.push(...cands);
    return direct(cands, { ...ctx, query: searches.map((x) => x.q).join(' | ') }, lenient)
      .catch((e) => { log('art director failed', e.message); return cands[0] ? { ...cands[0], fit: defaultFit(cands[0]) } : null; });
  };
  // 1. the slide's own specific searches, in the post's style and the other one, judged together
  const own = [{ q: queries[0], st: style }, ...(queries[1] ? [{ q: queries[1], st: style }] : []), ...(other !== style ? [{ q: queries[0], st: other }] : [])];
  let pick = await attempt(own, 16);
  if (pick) return pick;
  // 2. broader searches for the same subject
  const broader = queries.slice(2, 5).map((q) => ({ q, st: style }));
  if (broader.length) { pick = await attempt(broader, 16); if (pick) return pick; }
  // 3. best of everything seen, with a lenient brief
  return direct(uniq(seen).slice(0, 14), ctx, true).catch(() => null);
}

async function download(c, file) {
  const res = await http(c.url, { headers: UA, timeout: 90000 });
  if (!res.ok) throw new Error(`image ${res.status}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  if (c.downloadLocation && process.env.UNSPLASH_ACCESS_KEY) { // required by the Unsplash API guidelines
    await http(c.downloadLocation, { headers: { Authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}` }, retries: 0 }).catch(() => {});
  }
}

/** Attach a background to the cover and every slide that does not have one yet. */
export async function illustrate(post, dir, state) {
  const used = new Set(state.usedArt);
  const style = post.visual_style === 'photo' && process.env.UNSPLASH_ACCESS_KEY ? 'photo' : 'painting';
  if (post.visual_style === 'photo' && style !== 'photo') log('no UNSPLASH_ACCESS_KEY, falling back to paintings');
  const fallbacks = post.art_fallbacks ?? [];
  const targets = [];
  if (!post.coverArt) targets.push({ slot: 'cover', query: post.cover_art_query, text: post.title });
  post.slides.forEach((s, i) => { if (!s.art) targets.push({ slot: i, query: s.art_query, alts: s.art_alternatives ?? [], text: `${s.heading}. ${s.body}` }); });
  fs.mkdirSync(path.join(dir, 'art'), { recursive: true });

  for (const t of targets) {
    let pick = null;
    try { pick = await findArt({ title: post.title, text: t.text, query: t.query, fallbacks: [...(t.alts ?? []), ...fallbacks] }, style, used); } catch (e) { log('art search failed', e.message); }
    if (!pick) { log(`no art for "${t.query}", using plain background`); continue; }
    const file = path.join(dir, 'art', `${pick.key.replace(':', '-')}.jpg`);
    try { if (!fs.existsSync(file)) await download(pick, file); } catch (e) { log('download failed', e.message); continue; }
    used.add(pick.key);
    state.usedArt.push(pick.key);
    const art = { file: path.relative(dir, file), key: pick.key, kind: pick.kind, title: pick.title, artist: pick.artist, date: pick.date, museum: pick.source, license: pick.license, fit: pick.fit ?? defaultFit(pick), focus: pick.focus ?? [0.5, 0.35] };
    if (t.slot === 'cover') post.coverArt = art; else post.slides[t.slot].art = art;
    log(`art ${t.slot}: ${pick.artist}, ${pick.title}`);
  }
  // never leave a slide blank: reuse paintings already chosen for this post
  const chosen = [post.coverArt, ...post.slides.map((s) => s.art)].filter(Boolean);
  if (chosen.length) post.slides.forEach((s, i) => { if (!s.art) { s.art = chosen[(i + 1) % chosen.length]; log(`slide ${i + 1}: reusing an image from this post`); } });
  if (!post.coverArt && chosen.length) post.coverArt = chosen[0];
  post.credits = creditsLine(post);
  return post;
}

export function creditsLine(post) {
  const arts = [post.coverArt, ...post.slides.map((s) => s.art)].filter(Boolean);
  const seen = new Set();
  const uniq = arts.filter((a) => !seen.has(a.key) && seen.add(a.key));
  if (!uniq.length) return '';
  const unsplash = uniq.filter((a) => a.museum === 'Unsplash').map((a) => a.artist.replace(/^Photo by /, ''));
  const rest = uniq.filter((a) => a.museum !== 'Unsplash')
    .map((a) => `${a.artist}, ${a.title}${a.date ? ` (${a.date})` : ''}${a.license && !/public domain|^pd|cc0/i.test(a.license) ? ` [${a.license}]` : ''}`);
  const parts = [];
  if (rest.length) {
    const sources = [...new Set(uniq.filter((a) => a.museum !== 'Unsplash').map((a) => a.museum))].join(', ');
    parts.push(`Images: ${rest.join('; ')}. Via ${sources}.`);
  }
  if (unsplash.length) parts.push(`Photos: ${[...new Set(unsplash)].join(', ')} on Unsplash.`);
  return parts.join(' ');
}
