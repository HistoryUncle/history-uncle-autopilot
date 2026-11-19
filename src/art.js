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
const PER_QUERY = 8;

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
    source: 'Unsplash',
  }));
}

async function gather(query, style, used) {
  const lists = style === 'photo'
    ? [await searchUnsplash(query).catch(() => [])]
    : await Promise.all([searchAIC(query).catch(() => []), searchMet(query).catch(() => [])]);
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
    type: 'object', required: ['index', 'reason'],
    properties: { index: { type: 'integer' }, reason: { type: 'string' } },
  },
};

const DIRECTOR = `You are the art director of History Uncle, a history brand whose Instagram carousels must look like a calm, expensive editorial: classical paintings and refined photographs with white serif text set over the lower third.

Choose ONE background for the slide. Criteria, in order:
1. On topic: it must clearly belong to the slide's subject, period or place. A beautiful image that is off topic loses to a good image that is on topic.
2. Aesthetic: minimal and calm composition, strong mood, good light, negative space, high image quality. Avoid clutter, busy crowds, kitsch, text, watermarks, frames, low resolution, modern objects in a historical post.
3. Works with white text in the lower third: the lower part should be quiet rather than full of detail.
Never pick anything violent, graphic or sexual.
Return -1 if no candidate meets criteria 1 and 2.`;

async function fetchB64(url) {
  const res = await http(url, { headers: UA, retries: 0, timeout: 20000 });
  if (!res.ok) throw new Error(String(res.status));
  return Buffer.from(await res.arrayBuffer()).toString('base64');
}

async function direct(cands, ctx) {
  if (!process.env.ANTHROPIC_API_KEY || cands.length === 0) return cands[0] ?? null;
  const content = [{ type: 'text', text: `Post: ${ctx.title}\nSlide: ${ctx.text}\nVisual search used: ${ctx.query}\n\nCandidates:` }];
  const shown = [];
  for (const c of cands) {
    const b64 = await fetchB64(c.thumb).catch(() => null);
    if (!b64) continue;
    content.push({ type: 'text', text: `[${shown.length}] ${c.artist}${c.title ? `, ${c.title}` : ''}${c.date ? `, ${c.date}` : ''}` });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } });
    shown.push(c);
  }
  if (!shown.length) return null;
  const { index, reason } = await callTool({ model: brand().model.curator, system: DIRECTOR, user: content, tool: PICK_TOOL, maxTokens: 400 });
  log(`art director: ${index} (${reason})`);
  return shown[index] ?? null;
}

/* ---------- public ---------- */

export async function findArt(ctx, style, used) {
  const queries = [...new Set([ctx.query, ...(ctx.fallbacks ?? [])].filter(Boolean))];
  for (const q of queries) {
    const cands = await gather(q, style, used);
    const pick = await direct(cands, { ...ctx, query: q }).catch((e) => { log('art director failed', e.message); return cands[0]; });
    if (pick) return pick;
  }
  return null;
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
  post.slides.forEach((s, i) => { if (!s.art) targets.push({ slot: i, query: s.art_query, text: `${s.heading}. ${s.body}` }); });
  fs.mkdirSync(path.join(dir, 'art'), { recursive: true });

  for (const t of targets) {
    let pick = null;
    try { pick = await findArt({ title: post.title, text: t.text, query: t.query, fallbacks }, style, used); } catch (e) { log('art search failed', e.message); }
    if (!pick) { log(`no art for "${t.query}", using plain background`); continue; }
    const file = path.join(dir, 'art', `${pick.key.replace(':', '-')}.jpg`);
    try { if (!fs.existsSync(file)) await download(pick, file); } catch (e) { log('download failed', e.message); continue; }
    used.add(pick.key);
    state.usedArt.push(pick.key);
    const art = { file: path.relative(dir, file), key: pick.key, kind: pick.kind, title: pick.title, artist: pick.artist, date: pick.date, museum: pick.source };
    if (t.slot === 'cover') post.coverArt = art; else post.slides[t.slot].art = art;
    log(`art ${t.slot}: ${pick.artist}, ${pick.title}`);
  }
  post.credits = creditsLine(post);
  return post;
}

export function creditsLine(post) {
  const arts = [post.coverArt, ...post.slides.map((s) => s.art)].filter(Boolean);
  const seen = new Set();
  const uniq = arts.filter((a) => !seen.has(a.key) && seen.add(a.key));
  if (!uniq.length) return '';
  const paintings = uniq.filter((a) => a.kind !== 'photo').map((a) => `${a.artist}, ${a.title}${a.date ? ` (${a.date})` : ''}`);
  const photos = uniq.filter((a) => a.kind === 'photo').map((a) => a.artist.replace(/^Photo by /, ''));
  const parts = [];
  if (paintings.length) {
    const museums = [...new Set(uniq.filter((a) => a.kind !== 'photo').map((a) => a.museum))].join(' and ');
    parts.push(`Images: ${paintings.join('; ')}. Public domain, ${museums} open access.`);
  }
  if (photos.length) parts.push(`Photos: ${[...new Set(photos)].join(', ')} on Unsplash.`);
  return parts.join(' ');
}
