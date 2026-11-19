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

test('caption gets image credits appended', () => {
  assert.equal(finalCaption({ caption: 'Hook.', credits: 'Images: X.' }), 'Hook.\n\nImages: X.');
});

test('review card escapes HTML and lists issues', () => {
  const card = reviewCard('id1', { title: 'A <b>', engine: 'rules', caption: 'c', risk_notes: ['r'] },
    { issues: [{ where: 'slide 2', problem: 'p', severity: 'high', fix: 'f' }] }, [{ url: 'https://x.org', ok: false, status: 404 }]);
  assert.ok(card.includes('A &lt;b&gt;'));
  assert.ok(card.includes('🔴 slide 2'));
  assert.ok(card.includes('❌ https://x.org'));
});
