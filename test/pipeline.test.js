/**
 * End-to-end run with every external API mocked: Claude writes, the critic objects once,
 * the writer revises, museums return paintings, Telegram receives the album, the owner
 * presses "now", Instagram publishes, and a READ comment gets a DM.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hu-'));
Object.assign(process.env, {
  HU_STATE_DIR: tmp, ANTHROPIC_API_KEY: 'k', TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: '42',
  IG_ACCESS_TOKEN: 'ig', PUBLISH_MODE: 'auto', GITHUB_REPOSITORY: 'matas/history-uncle-autopilot', GITHUB_REF_NAME: 'main',
});
const painting = fs.readFileSync(new URL('./fixtures/painting.jpg', import.meta.url));
const sample = JSON.parse(fs.readFileSync(new URL('../samples/sample-post.json', import.meta.url)));

const calls = [];
let criticRound = 0;
let pickCalls = 0;
let tgUpdates = [];
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  const body = typeof opts.body === 'string' ? JSON.parse(opts.body) : null;
  calls.push({ url, method: opts.method ?? 'GET', body });

  if (url.includes('api.anthropic.com')) {
    if (body.tools[0].name === 'carousel') {
      const { engine, kicker, ...post } = sample;
      return json({ content: [{ type: 'tool_use', name: 'carousel', input: { ...post, title: post.title + ' — Revised', urls: ['https://example.org/'] } }] });
    }
    if (body.tools[0].name === 'pick') { pickCalls++; return json({ content: [{ type: 'tool_use', name: 'pick', input: { index: 0, reason: 'on topic' } }] }); }
    criticRound++;
    const issues = criticRound === 1 ? [{ where: 'slide 2', problem: 'wrong year', severity: 'high', fix: 'use 1976' }] : [];
    return json({ content: [{ type: 'tool_use', name: 'review', input: { verdict: issues.length ? 'needs_fixes' : 'publishable', issues } }] });
  }
  if (url.includes('api.artic.edu')) {
    const n = calls.filter((c) => c.url.includes('api.artic.edu')).length;
    return json({ data: [{ id: 1000 + n, title: `Painting ${n}`, artist_title: `Painter ${n}`, date_display: 'c. 1850', image_id: `img${n}`, artwork_type_title: 'Painting', thumbnail: { width: 800, height: 1000 } }] });
  }
  if (url.includes('collectionapi.metmuseum.org')) return json({ objectIDs: [] });
  if (url.includes('commons.wikimedia.org')) return json({ query: { pages: {} } });
  if (url.includes('artic.edu/iiif')) return new Response(painting, { headers: { 'content-type': 'image/jpeg' } });
  if (url.startsWith('https://example.org')) return new Response('', { status: 200 });

  if (url.includes('api.telegram.org')) {
    if (url.endsWith('sendMediaGroup')) return json({ ok: true, result: [{ message_id: 10 }] });
    if (url.endsWith('sendMessage')) return json({ ok: true, result: { message_id: 11 } });
    if (url.endsWith('getUpdates')) { const r = tgUpdates; tgUpdates = []; return json({ ok: true, result: r }); }
    return json({ ok: true, result: true });
  }
  if (url.includes('raw.githubusercontent.com')) return new Response('', { status: 200 });

  if (url.includes('graph.instagram.com')) {
    const u = new URL(url);
    if (u.pathname.endsWith('/me')) return json({ user_id: '1784', username: 'historyuncle', id: '99' });
    if (u.pathname.endsWith('/media') && opts.method === 'POST') return json({ id: `c${calls.length}` });
    if (u.pathname.endsWith('/media_publish')) return json({ id: 'm1' });
    if (u.pathname.endsWith('/media')) return json({ data: [{ id: 'm1', timestamp: new Date().toISOString() }] });
    if (u.pathname.endsWith('/m1/comments')) return json({ data: [
      { id: 'cm1', text: 'read please', timestamp: new Date().toISOString(), username: 'reader1' },
      { id: 'cm2', text: 'nice post', timestamp: new Date().toISOString(), username: 'reader2' },
    ] });
    if (u.pathname.endsWith('/m1')) return json({ id: 'm1', permalink: 'https://instagram.com/p/abc', timestamp: 'x' });
    if (u.pathname.endsWith('/messages')) return json({ recipient_id: 'r', message_id: 'dm1' });
    if (u.pathname.endsWith('/replies')) return json({ id: 'rep1' });
    if (u.searchParams.get('fields') === 'status_code') return json({ status_code: 'FINISHED' });
  }
  throw new Error('unmocked ' + url);
};

const S = await import('../src/lib/state.js');
const { createDraft, handleTelegram, publishDue } = await import('../src/pipeline.js');
const { runDmFunnel } = await import('../src/instagram.js');

test('draft -> approve now -> publish -> DM funnel', { timeout: 120000 }, async () => {
  const state = S.load();
  const id = await createDraft(state, { engineId: 'reading-path' });
  S.save(state);

  // critic objected once, so the writer was called twice
  assert.equal(calls.filter((c) => c.body?.tools?.[0]?.name === 'carousel').length, 2);
  const post = S.loadDraft(id);
  assert.ok(!/[—–]/.test(post.title), 'house style applied to model output');
  assert.equal(fs.readdirSync(path.join(tmp, 'drafts', id, 'r1')).filter((f) => f.endsWith('.jpg')).length, 9);
  assert.ok(post.coverArt && post.slides.every((s) => s.art), 'every slide has a painting');
  assert.match(post.credits, /Painter \d+/);
  const keys = [post.coverArt, ...post.slides.map((x) => x.art)].map((a) => a.key);
  assert.equal(new Set(keys).size, keys.length, 'every slide has a different image');
  assert.equal(pickCalls, 8, 'art director chose every background');
  assert.equal(post.links[0].ok, true);
  assert.equal(state.drafts[id].status, 'pending');
  assert.ok(calls.some((c) => c.url.endsWith('sendMediaGroup')));

  // owner presses "Publikuoti dabar"
  tgUpdates = [{ update_id: 5, callback_query: { id: 'q', data: `now:${id}`, message: { message_id: 11, chat: { id: 42 } } } }];
  await handleTelegram(state);
  assert.equal(state.drafts[id].status, 'approved');
  assert.equal(state.telegramOffset, 6);

  await publishDue(state, new Date(Date.now() + 1000));
  assert.equal(state.drafts[id].status, 'published');
  const children = calls.filter((c) => c.url.includes('graph.instagram.com') && c.body?.is_carousel_item);
  assert.equal(children.length, 9);
  assert.match(children[0].body.image_url, /raw\.githubusercontent\.com\/matas\/history-uncle-autopilot\/main\/state\/drafts\/.+\/r1\/01\.jpg/);
  const parent = calls.find((c) => c.body?.media_type === 'CAROUSEL');
  assert.match(parent.body.caption, /Comment READ/);
  assert.match(parent.body.caption, /Images: /);

  // comment funnel: only the READ comment gets a DM, and only once
  assert.equal(await runDmFunnel(state), 1);
  assert.equal(await runDmFunnel(state), 0);
  const dm = calls.find((c) => c.url.includes('graph.instagram.com') && c.url.endsWith('/messages'));
  assert.deepEqual(dm.body.recipient, { comment_id: 'cm1' });
});

test('a stranger cannot approve drafts', async () => {
  const state = S.load();
  const id = Object.keys(state.drafts)[0];
  state.drafts[id].status = 'pending';
  tgUpdates = [{ update_id: 9, callback_query: { id: 'q', data: `ok:${id}`, message: { message_id: 11, chat: { id: 666 } } } }];
  await handleTelegram(state);
  assert.equal(state.drafts[id].status, 'pending');
});

test('manual mode: approve sends a ready-to-post package, no Instagram calls', async () => {
  process.env.PUBLISH_MODE = 'manual';
  const state = S.load();
  const id = await createDraft(state, { engineId: 'reading-path' });
  const before = calls.length;
  tgUpdates = [{ update_id: 20, callback_query: { id: 'q', data: `ok:${id}`, message: { message_id: 11, chat: { id: 42 } } } }];
  await handleTelegram(state);
  assert.equal(state.drafts[id].status, 'ready');
  const after = calls.slice(before);
  assert.ok(after.some((c) => c.url.endsWith('sendMediaGroup')), 'slides re-sent');
  const pre = after.find((c) => c.body?.text?.startsWith('<pre>'));
  assert.ok(pre, 'caption sent in a copyable block');
  assert.match(pre.body.text, /Substack link in bio\./);
  assert.doesNotMatch(pre.body.text, /Comment READ/);
  await publishDue(state, new Date(Date.now() + 1e9));
  assert.ok(!calls.slice(before).some((c) => c.url.includes('graph.instagram.com')), 'nothing published via API');
  process.env.PUBLISH_MODE = 'auto';
});
