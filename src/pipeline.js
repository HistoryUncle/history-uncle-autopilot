import fs from 'node:fs';
import path from 'node:path';
import { brand, publishMode, http, log } from './lib/util.js';
import * as S from './lib/state.js';
import { writePost, checkUrls } from './generate.js';
import { illustrate } from './art.js';
import { render } from './render.js';
import * as tg from './telegram.js';
import * as ig from './instagram.js';

/* ---------- drafting ---------- */

export function finalCaption(post) {
  // The comment-to-DM promise only makes sense when the Instagram API is connected.
  let caption = post.caption;
  if (publishMode() !== 'auto' || !brand().dm_funnel.enabled) caption = caption.replace(/^.*Comment READ.*$/m, 'Substack link in bio.');
  const cap = post.credits ? `${caption}\n\n${post.credits}` : caption;
  return cap.length > 2150 ? caption.slice(0, 2150) : cap;
}

/** Render into a fresh folder per revision so CDN caches never serve an old version. */
async function produce(id, post, state, rev) {
  const dir = S.draftDir(id);
  fs.mkdirSync(dir, { recursive: true });
  await illustrate(post, dir, state); // fills only what is missing
  post.renderDir = `r${rev}`;
  const files = await render(post, dir, post.renderDir);
  const urls = [...(post.urls ?? []), ...(post.caption.match(/https?:\/\/[^\s)]+/g) ?? [])];
  const links = urls.length ? await checkUrls(urls) : [];
  return { files, links };
}

export async function createDraft(state, { engineId, topicHint } = {}) {
  const id = S.newId();
  const { post, review } = await writePost({ state, engineId, topicHint });
  const { files, links } = await produce(id, post, state, 1);
  post.review = review; post.links = links; post.rev = 1;
  S.saveDraft(id, post);
  await tg.sendAlbum(files);
  const card = await tg.sendText(tg.reviewCard(id, post, review, links), tg.buttons(id));
  state.drafts[id] = { status: 'pending', engine: post.engine, title: post.title, createdAt: new Date().toISOString(), telegramMessageId: card.message_id };
  log(`draft ${id} ready: ${post.title}`);
  return id;
}

async function reviseDraft(state, id, feedback) {
  const meta = state.drafts[id];
  const prev = S.loadDraft(id);
  const { post, review } = await writePost({ state, previous: prev, feedback });
  // keep the paintings unless the feedback is about images; new slides get fresh ones in produce()
  const wantsNewArt = /paveiksl|vaizd|image|painting|art\b/i.test(feedback);
  if (!wantsNewArt) {
    post.coverArt = prev.coverArt;
    post.slides.forEach((s, i) => { if (prev.slides[i]?.art) s.art = prev.slides[i].art; });
  }
  const rev = (prev.rev ?? 1) + 1;
  const { files, links } = await produce(id, post, state, rev);
  post.review = review; post.links = links; post.rev = rev;
  S.saveDraft(id, post);
  await tg.clearButtons(meta.telegramMessageId);
  await tg.sendAlbum(files);
  const card = await tg.sendText(tg.reviewCard(id, post, review, links), tg.buttons(id));
  Object.assign(meta, { title: post.title, telegramMessageId: card.message_id, status: 'pending' });
}

/* ---------- scheduling ---------- */

function tzOffsetMinutes(date, timeZone) {
  const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(date).find((x) => x.type === 'timeZoneName').value;
  const m = part.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
}

/** Next publish slot (e.g. 18:15 Vilnius) after `now`, skipping slots already taken. */
export function nextSlot(state, now = new Date()) {
  const { timezone, publish_hour_local: h, publish_minute_local: mi } = brand().schedule;
  const taken = new Set(Object.values(state.drafts).filter((d) => d.status === 'approved').map((d) => d.publishAt?.slice(0, 10)));
  for (let d = 0; d < 30; d++) {
    const local = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
    local.setDate(local.getDate() + d);
    const guess = Date.UTC(local.getFullYear(), local.getMonth(), local.getDate(), h, mi);
    const utc = new Date(guess - tzOffsetMinutes(new Date(guess), timezone) * 60000);
    if (utc > now && !taken.has(utc.toISOString().slice(0, 10))) return utc;
  }
  return new Date(now.getTime() + 3600000);
}

const fmtLocal = (d) => d.toLocaleString('lt-LT', { timeZone: brand().schedule.timezone, weekday: 'long', hour: '2-digit', minute: '2-digit', month: 'long', day: 'numeric' });

/* ---------- publishing ---------- */

function publicUrls(id, post) {
  const repo = process.env.GITHUB_REPOSITORY;
  const branch = process.env.MEDIA_BRANCH || process.env.GITHUB_REF_NAME || 'main';
  if (!repo) throw new Error('GITHUB_REPOSITORY not set (run inside GitHub Actions).');
  const dir = path.join(S.draftDir(id), post.renderDir);
  return fs.readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort()
    .map((f) => `https://raw.githubusercontent.com/${repo}/${branch}/state/drafts/${id}/${post.renderDir}/${f}`);
}

export async function publishDue(state, now = new Date()) {
  if (publishMode() !== 'auto') return;
  const due = Object.entries(state.drafts)
    .filter(([, d]) => d.status === 'approved' && new Date(d.publishAt) <= now)
    .sort(([, a], [, b]) => a.publishAt.localeCompare(b.publishAt));
  for (const [id, meta] of due.slice(0, 1)) { // at most one post per run
    const post = S.loadDraft(id);
    const urls = publicUrls(id, post);
    const probe = await http(urls[0], { method: 'HEAD', retries: 0 }).catch(() => null);
    if (!probe?.ok) { log(`images for ${id} not public yet, retry next run`); continue; }
    try {
      const media = await ig.publishCarousel(urls, finalCaption(post));
      Object.assign(meta, { status: 'published', igMediaId: media.id, permalink: media.permalink, publishedAt: new Date().toISOString() });
      state.history.push({ id, title: post.title, engine: post.engine, publishedAt: meta.publishedAt, permalink: media.permalink });
      await tg.sendText(`📤 Paskelbta: <b>${post.title}</b>\n${media.permalink}`);
    } catch (e) {
      meta.failures = (meta.failures ?? 0) + 1;
      if (meta.failures >= 3) meta.status = 'failed';
      await tg.sendText(`⚠️ Nepavyko paskelbti <b>${post.title}</b> (bandymas ${meta.failures}/3):\n<code>${String(e.message).slice(0, 600)}</code>`);
    }
  }
}

/* ---------- telegram inbox ---------- */

export async function handleTelegram(state, waitSeconds = 0) {
  const updates = await tg.getUpdates(state.telegramOffset, waitSeconds);
  if (updates.length) log(`telegram: ${updates.length} update(s)`);
  for (const u of updates) {
    state.telegramOffset = u.update_id + 1;
    try {
      if (u.callback_query) await onButton(state, u.callback_query);
      else if (u.message) await onMessage(state, u.message);
    } catch (e) {
      log('update failed', e.stack);
      await tg.sendText(`⚠️ Klaida: <code>${String(e.message).slice(0, 600)}</code>`).catch(() => {});
    }
  }
  return updates.length;
}

async function onButton(state, q) {
  if (!tg.isOwner(q.message?.chat)) return;
  const [action, id] = q.data.split(':');
  const meta = state.drafts[id];
  if (!meta || meta.status === 'published') return tg.answer(q.id, 'Šis juodraštis jau nebeaktualus.');
  await tg.clearButtons(q.message.message_id);

  if ((action === 'ok' || action === 'now') && publishMode() !== 'auto') {
    const post = S.loadDraft(id);
    const dir = path.join(S.draftDir(id), post.renderDir);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort().map((f) => path.join(dir, f));
    Object.assign(meta, { status: 'ready', approvedAt: new Date().toISOString() });
    state.history.push({ id, title: post.title, engine: post.engine, publishedAt: meta.approvedAt, manual: true });
    await tg.answer(q.id, 'Ruošiu įkėlimui');
    await tg.sendReadyPackage(files, finalCaption(post), post.title);
  } else if (action === 'ok') {
    const at = nextSlot(state);
    Object.assign(meta, { status: 'approved', publishAt: at.toISOString() });
    await tg.answer(q.id, 'Patvirtinta');
    await tg.sendText(`✅ <b>${meta.title}</b> išeis ${fmtLocal(at)}.`);
  } else if (action === 'now') {
    Object.assign(meta, { status: 'approved', publishAt: new Date().toISOString() });
    await tg.answer(q.id, 'Publikuojama');
    await tg.sendText(`⚡ <b>${meta.title}</b> bus paskelbtas per kelias minutes.`);
  } else if (action === 'no') {
    meta.status = 'rejected';
    await tg.answer(q.id, 'Atmesta');
  } else if (action === 'new') {
    meta.status = 'rejected';
    await tg.answer(q.id, 'Ruošiu kitą temą');
    await tg.sendText('🔄 Ruošiu kitą temą, atsiųsiu po kelių minučių.');
    await createDraft(state);
  }
}

async function onMessage(state, m) {
  if (!tg.isOwner(m.chat) || !m.text) return;
  const text = m.text.trim();
  const replyTo = m.reply_to_message?.message_id;
  const target = replyTo && Object.entries(state.drafts).find(([, d]) => d.telegramMessageId === replyTo && d.status !== 'published');

  if (target) {
    await tg.sendText('✏️ Taisau pagal tavo pastabas...');
    return reviseDraft(state, target[0], text);
  }
  if (/^\/(nauja|new)\b/i.test(text)) {
    const hint = text.replace(/^\/\S+\s*/, '');
    await tg.sendText(`🛠 Ruošiu naują juodraštį${hint ? `: <i>${hint}</i>` : ''}...`);
    return createDraft(state, { topicHint: hint || undefined });
  }
  if (/^\/(eile|queue|status)\b/i.test(text)) {
    const rows = Object.entries(state.drafts).filter(([, d]) => ['pending', 'approved'].includes(d.status))
      .map(([id, d]) => `${d.status === 'approved' ? '🗓 ' + fmtLocal(new Date(d.publishAt)) : '⏳ laukia patvirtinimo'}: <b>${d.title}</b> <code>${id}</code>`);
    return tg.sendText(rows.length ? rows.join('\n') : 'Eilė tuščia. Naujas juodraštis: /nauja arba /nauja [tema]');
  }
  return tg.sendText('Komandos:\n/nauja: naujas juodraštis\n/nauja [tema]: juodraštis tavo tema\n/eile: kas laukia ir kas suplanuota\nReply į juodraščio žinutę: pataisymai');
}
