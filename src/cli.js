#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { log, readJSON, deepHouseStyle } from './lib/util.js';
import * as S from './lib/state.js';
import { createDraft, handleTelegram, publishDue } from './pipeline.js';
import { runDmFunnel, refreshToken } from './instagram.js';
import { render } from './render.js';
import { illustrate } from './art.js';
import * as tg from './telegram.js';

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : undefined; };

async function step(name, fn, state) {
  try { await fn(); } catch (e) {
    log(`${name} failed:`, e.stack || e.message);
    await tg.sendText(`⚠️ ${name}: <code>${String(e.message).slice(0, 500)}</code>`).catch(() => {});
    process.exitCode = 1;
  } finally { if (state) S.save(state); }
}

const commands = {
  /** Cron: write, illustrate, render and send a new draft to Telegram for approval. */
  async draft() {
    const state = S.load();
    const pending = Object.values(state.drafts).filter((d) => d.status === 'pending').length;
    const maxPending = Number(process.env.MAX_PENDING ?? 3);
    if (pending >= maxPending && !flag('force')) {
      log(`${pending} drafts already waiting for approval, skipping`);
      await tg.sendText(`⏳ Laukia ${pending} nepatvirtinti juodraščiai, naujo nekuriu. Peržiūrėk juos arba parašyk /nauja.`).catch(() => {});
      return;
    }
    await step('Juodraštis', () => createDraft(state, { engineId: flag('engine'), topicHint: flag('topic') }), state);
  },

  /** Every 15 minutes: Telegram buttons and replies, due posts, comment-to-DM funnel. */
  async tick() {
    const state = S.load();
    await step('Telegram', () => handleTelegram(state), state);
    if (process.env.IG_ACCESS_TOKEN) {
      await step('Publikavimas', () => publishDue(state), state);
      await step('DM funnel', async () => { const n = await runDmFunnel(state); if (n) log(`sent ${n} DMs`); }, state);
    }
  },

  /** Local preview: node src/cli.js preview samples/sample-post.json [--art] */
  async preview() {
    const file = rest.find((x) => !x.startsWith('--')) ?? 'samples/sample-post.json';
    const post = deepHouseStyle(readJSON(path.resolve(file)));
    const dir = path.resolve('preview');
    fs.mkdirSync(dir, { recursive: true });
    if (rest.includes('--art')) await illustrate(post, dir, S.load());
    const files = await render(post, dir);
    log(`preview written to ${dir}/slides (${files.length} slides)`);
  },

  /** Monthly: refresh the 60-day Instagram token and store it back in GitHub Secrets. */
  async 'refresh-token'() {
    const data = await refreshToken();
    if (process.env.GITHUB_ACTIONS) console.log(`::add-mask::${data.access_token}`);
    const out = process.env.GITHUB_OUTPUT;
    if (out) fs.appendFileSync(out, `token<<EOF\n${data.access_token}\nEOF\n`);
    log(`token refreshed, valid ${Math.round(data.expires_in / 86400)} days`);
  },
};

if (!commands[cmd]) {
  console.log('Usage: node src/cli.js <draft [--engine id] [--topic "..."] [--force] | tick | preview [file] [--art] | refresh-token>');
  process.exit(1);
}
await commands[cmd]();
