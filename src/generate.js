import fs from 'node:fs';
import { brand, engines, p, log, deepHouseStyle, wordCount, weightedPick, http } from './lib/util.js';
import { callTool, CAROUSEL_TOOL, REVIEW_TOOL } from './lib/claude.js';
import { recentTitles } from './lib/state.js';

const writerSystem = () => fs.readFileSync(p('prompts', 'writer.md'), 'utf8');
const criticSystem = () => fs.readFileSync(p('prompts', 'critic.md'), 'utf8');

export function chooseEngine(state, forcedId) {
  const all = engines();
  if (forcedId) {
    const e = all.find((x) => x.id === forcedId);
    if (!e) throw new Error(`Unknown engine "${forcedId}". Options: ${all.map((x) => x.id).join(', ')}`);
    return e;
  }
  const last = state.history.at(-1)?.engine;
  const pool = all.filter((e) => e.id !== last);
  return weightedPick(pool.length ? pool : all);
}

function writerPrompt({ engine, recent, feedback, previous, topicHint }) {
  const b = brand();
  const parts = [
    `Engine: ${engine.label}`,
    `Brief: ${engine.brief}`,
    `Example titles in this engine (do not copy, find a fresh topic): ${engine.examples.join(' | ')}`,
    `Content slides: between ${b.slides.min_content_slides} and ${b.slides.max_content_slides}.`,
    `Recent titles (do not repeat or closely paraphrase):\n${recent.map((t) => `- ${t}`).join('\n') || '- none yet'}`,
  ];
  if (topicHint) parts.push(`The editor asked for this topic or angle: ${topicHint}`);
  if (previous) parts.push(`Previous draft (JSON):\n${JSON.stringify(previous, null, 1)}`);
  if (feedback) parts.push(`Revise the previous draft. Apply this feedback exactly, keep everything else that is sound:\n${feedback}`);
  return parts.join('\n\n');
}

/** Mechanical checks that do not need a model. */
export function lint(post) {
  const issues = [];
  const b = brand();
  const n = post.slides?.length ?? 0;
  if (n < b.slides.min_content_slides || n > b.slides.max_content_slides) {
    issues.push({ where: 'slides', problem: `${n} content slides, expected ${b.slides.min_content_slides}-${b.slides.max_content_slides}`, severity: 'medium', fix: 'adjust slide count' });
  }
  if (wordCount(post.title) > 7) issues.push({ where: 'cover', problem: 'title over 7 words', severity: 'low', fix: 'shorten' });
  post.slides?.forEach((s, i) => {
    const w = wordCount(s.body);
    if (w > 46) issues.push({ where: `slide ${i + 1}`, problem: `body is ${w} words (max 40)`, severity: 'low', fix: 'tighten' });
    if (wordCount(s.heading) > 7) issues.push({ where: `slide ${i + 1}`, problem: 'heading over 6 words', severity: 'low', fix: 'shorten' });
  });
  return issues;
}

/** HEAD/GET every URL so dead or invented links are caught before you approve. */
export async function checkUrls(urls = []) {
  const results = [];
  for (const url of [...new Set(urls)].slice(0, 15)) {
    try {
      let res = await http(url, { method: 'HEAD', retries: 0, timeout: 15000 });
      if (res.status >= 400) res = await http(url, { retries: 0, timeout: 15000 });
      results.push({ url, ok: res.status < 400, status: res.status });
    } catch (e) {
      results.push({ url, ok: false, status: String(e.message).slice(0, 60) });
    }
  }
  return results;
}

/**
 * Writer -> hostile critic -> (revise once if high-severity issues) -> final critic.
 * Returns the post plus the review, so the remaining flags can be shown in Telegram.
 */
export async function writePost({ state, engineId, feedback, previous, topicHint }) {
  const b = brand();
  const engine = previous?.engine ? chooseEngine(state, previous.engine) : chooseEngine(state, engineId);
  const recent = recentTitles(state);
  log(`writing: engine=${engine.id}${feedback ? ' (revision)' : ''}`);

  let post = deepHouseStyle(await callTool({
    model: b.model.writer,
    system: writerSystem(),
    user: writerPrompt({ engine, recent, feedback, previous: previous && strip(previous), topicHint }),
    tool: CAROUSEL_TOOL,
  }));

  let review = await critique(post);
  for (let i = 0; i < b.model.max_revisions && review.issues.some((x) => x.severity === 'high'); i++) {
    log(`critic found ${review.issues.length} issues, revising`);
    const fb = review.issues.map((x) => `- [${x.severity}] ${x.where}: ${x.problem} -> ${x.fix}`).join('\n');
    post = deepHouseStyle(await callTool({
      model: b.model.writer,
      system: writerSystem(),
      user: writerPrompt({ engine, recent, feedback: fb, previous: post }),
      tool: CAROUSEL_TOOL,
    }));
    review = await critique(post);
  }

  post.engine = engine.id;
  post.kicker = engine.kicker;
  review.issues.push(...lint(post));
  return { post, review };
}

async function critique(post) {
  const b = brand();
  return callTool({
    model: b.model.critic,
    system: criticSystem(),
    user: `Review this carousel:\n\n${JSON.stringify(strip(post), null, 1)}`,
    tool: REVIEW_TOOL,
    maxTokens: 4000,
  });
}

/** Remove render-only fields before sending a post back to the model. */
function strip(post) {
  const { art, coverArt, credits, ...rest } = post;
  return { ...rest, slides: rest.slides?.map(({ art: _a, ...s }) => s) };
}
