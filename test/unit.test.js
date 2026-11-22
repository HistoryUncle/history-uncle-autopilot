import { test } from 'node:test';
import assert from 'node:assert/strict';
import { houseStyle, deepHouseStyle, roman } from '../src/lib/util.js';
import { lint } from '../src/generate.js';
import { nextSlot, finalCaption } from '../src/pipeline.js';
import { reviewCard } from '../src/telegram.js';

test('house style removes dashes, hashtags, exclamation marks', () => {
  assert.equal(houseStyle('Rome fell — slowly'), 'Rome fell, slowly');
  assert.equal(houseStyle('Trade 1450–1520 grew'), 'Trade 1450-1520 grew');
  assert.equal(houseStyle('Amazing! #history #rome'), 'Amazing.');
  assert.ok(!/[—–]/.test(houseStyle('a—b–c')));
});

test('caption keeps line breaks and URLs', () => {
  const out = deepHouseStyle({ caption: 'Hook — here.\n\nhttps://ocw.mit.edu/courses/\nComment READ!' });
  assert.equal(out.caption, 'Hook, here.\n\nhttps://ocw.mit.edu/courses/\nComment READ.');
});

test('roman numerals', () => {
  assert.deepEqual([1, 4, 9, 14, 40].map(roman), ['I', 'IV', 'IX', 'XIV', 'XL']);
});

test('lint flags long bodies and wrong slide counts', () => {
  const issues = lint({ title: 'A B C', slides: [{ heading: 'x', body: 'word '.repeat(60) }] });
  assert.ok(issues.some((i) => i.where === 'slides'));
  assert.ok(issues.some((i) => /words/.test(i.problem)));
});

test('next publish slot is 18:15 Vilnius and skips taken days', () => {
  const now = new Date('2026-11-19T10:00:00Z'); // 12:00 Vilnius (UTC+2)
  const s1 = nextSlot({ drafts: {} }, now);
  assert.equal(s1.toISOString(), '2026-11-19T16:15:00.000Z');
  const s2 = nextSlot({ drafts: { a: { status: 'approved', publishAt: s1.toISOString() } } }, now);
  assert.equal(s2.toISOString(), '2026-11-20T16:15:00.000Z');
  const late = nextSlot({ drafts: {} }, new Date('2026-11-19T17:00:00Z'));
  assert.equal(late.toISOString(), '2026-11-20T16:15:00.000Z');
  const summer = nextSlot({ drafts: {} }, new Date('2027-07-01T08:00:00Z')); // UTC+3
  assert.equal(summer.toISOString(), '2027-07-01T15:15:00.000Z');
});

test('caption gets image credits appended; READ line swapped in manual mode', () => {
  process.env.PUBLISH_MODE = 'auto';
  assert.equal(finalCaption({ caption: 'Hook.', credits: 'Images: X.' }), 'Hook.\n\nImages: X.');
  process.env.PUBLISH_MODE = 'manual';
  assert.equal(finalCaption({ caption: 'Hook.\nComment READ and I will send you the Substack link.' }), 'Hook.\nSubstack link in bio.');
  delete process.env.PUBLISH_MODE;
});

test('review card escapes HTML and lists issues', () => {
  const card = reviewCard('id1', { title: 'A <b>', engine: 'rules', caption: 'c', risk_notes: ['r'] },
    { issues: [{ where: 'slide 2', problem: 'p', severity: 'high', fix: 'f' }] }, [{ url: 'https://x.org', ok: false, status: 404 }]);
  assert.ok(card.includes('A &lt;b&gt;'));
  assert.ok(card.includes('🔴 slide 2'));
  assert.ok(card.includes('❌ https://x.org'));
});

test('wikimedia metadata is cleaned for credits', async () => {
  const { cleanTitle, cleanArtist, cleanDate } = await import('../src/art.js');
  assert.equal(cleanTitle('title QS:P1476,en:"The Geographer "label QS:Len,"The Geographer "label QS:L'), '');
  assert.equal(cleanTitle('The Geographer title QS:P1476,en:"The Geographer "'), 'The Geographer');
  assert.equal(cleanTitle('German: Frau am Fenster English: Woman at a Window title QS:P1476,de:"Frau am Fenster"'), 'Woman at a Window');
  assert.equal(cleanTitle('Polish: Myśliwi na śniegu'), 'Myśliwi na śniegu');
  assert.equal(cleanArtist('Unknown authorUnknown author'), 'Unknown author');
  assert.equal(cleanDate('1674date QS:P571,+1674-00-00T00:00:00Z/9'), '1674');
  assert.equal(cleanDate('1500–10'), '1500-10');
});

test('scheduled draft is due on draft days after 08:37 Vilnius, once per day', async () => {
  const { scheduledDraftDue, markScheduledDraft } = await import('../src/pipeline.js');
  const st = {};
  assert.equal(scheduledDraftDue(st, new Date('2026-11-23T06:30:00Z')), false); // Mon 08:30
  assert.equal(scheduledDraftDue(st, new Date('2026-11-23T06:40:00Z')), true);  // Mon 08:40
  markScheduledDraft(st, new Date('2026-11-23T06:40:00Z'));
  assert.equal(scheduledDraftDue(st, new Date('2026-11-23T10:00:00Z')), false); // already made
  assert.equal(scheduledDraftDue({}, new Date('2026-11-24T10:00:00Z')), false); // Tuesday
});

test('cover with a wide "frame" painting renders (regression)', { timeout: 120000 }, async () => {
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
  const { render } = await import('../src/render.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hu-frame-'));
  fs.mkdirSync(path.join(dir, 'art'));
  fs.copyFileSync(new URL('./fixtures/wide.jpg', import.meta.url), path.join(dir, 'art', 'w.jpg'));
  const W = { file: 'art/w.jpg', key: 'w', artist: 'A', title: 'B', fit: 'frame' };
  const post = { title: 'A Wide Cover Test', title_lead: 'Finally:', coverArt: W, slides: [{ heading: 'H', body: 'Body text here.', art: W }] };
  const files = await render(post, dir);
  assert.equal(files.length, 3);
});
