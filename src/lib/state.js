import fs from 'node:fs';
import path from 'node:path';
import { p, readJSON, writeJSON } from './util.js';

const STATE = () => process.env.HU_STATE_DIR || p('state');

/**
 * All state lives in the repo (state/state.json + state/drafts/<id>/), so GitHub Actions
 * runs can pick up where the last one stopped. Workflows commit it back after each run.
 */
const FILE = () => path.join(STATE(), 'state.json');

const empty = () => ({
  telegramOffset: 0,
  history: [],          // [{id, title, engine, publishedAt, permalink}]
  usedArt: [],          // ["aic:12345", "met:437133"]
  repliedComments: [],  // comment ids already DM'd
  drafts: {},           // id -> {status, engine, title, createdAt, telegramMessageId, publishAt, igMediaId, permalink}
});

export function load() {
  return { ...empty(), ...readJSON(FILE(), empty()) };
}

export function save(state) {
  // keep files from growing forever
  state.repliedComments = state.repliedComments.slice(-3000);
  state.usedArt = state.usedArt.slice(-1500);
  state.history = state.history.slice(-400);
  writeJSON(FILE(), state);
}

export const draftDir = (id) => path.join(STATE(), 'drafts', id);
export const draftFile = (id) => path.join(draftDir(id), 'post.json');
export const loadDraft = (id) => readJSON(draftFile(id));
export const saveDraft = (id, post) => writeJSON(draftFile(id), post);
export const draftExists = (id) => fs.existsSync(draftFile(id));

export function newId() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

export function recentTitles(state, n = 80) {
  const fromHistory = state.history.map((h) => h.title);
  const fromDrafts = Object.values(state.drafts).map((d) => d.title);
  return [...new Set([...fromHistory, ...fromDrafts])].slice(-n);
}
