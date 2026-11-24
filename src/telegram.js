import fs from 'node:fs';
import path from 'node:path';
import { publishMode, env, http, escapeHtml as e } from './lib/util.js';

/**
 * Telegram bot = your approval desk. No server needed: a GitHub Actions job long-polls
 * getUpdates (answers within seconds) and acts on button presses and replies.
 */
const api = (method) => `https://api.telegram.org/bot${env('TELEGRAM_BOT_TOKEN')}/${method}`;
const chatId = () => env('TELEGRAM_CHAT_ID');

async function call(method, payload) {
  const res = await http(api(method), { method: 'POST', json: payload });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram ${method}: ${data.description}`);
  return data.result;
}

const stripTags = (t) => t.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

/** HTML message; never cut inside a tag. If Telegram still rejects the markup, resend as plain text. */
export async function sendText(text, extra = {}) {
  if (text.length > 4096) text = stripTags(text).slice(0, 4000) + '…';
  const plain = !/<[a-z]/i.test(text);
  try {
    return await call('sendMessage', { chat_id: chatId(), text, ...(plain ? {} : { parse_mode: 'HTML' }), disable_web_page_preview: true, ...extra });
  } catch (err) {
    if (!/parse entities|message is too long/i.test(err.message)) throw err;
    return call('sendMessage', { chat_id: chatId(), text: stripTags(text).slice(0, 4000), disable_web_page_preview: true, ...extra });
  }
}

export async function sendAlbum(files) {
  const form = new FormData();
  form.append('chat_id', chatId());
  form.append('media', JSON.stringify(files.slice(0, 10).map((_, i) => ({ type: 'photo', media: `attach://p${i}` }))));
  files.slice(0, 10).forEach((f, i) => form.append(`p${i}`, new Blob([fs.readFileSync(f)], { type: 'image/jpeg' }), path.basename(f)));
  const res = await http(api('sendMediaGroup'), { method: 'POST', body: form, timeout: 120000 });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram sendMediaGroup: ${data.description}`);
  return data.result;
}

const manual = () => publishMode() !== 'auto';

export const buttons = (id) => ({
  reply_markup: {
    inline_keyboard: manual()
      ? [
        [{ text: '✅ Patvirtinti', callback_data: `ok:${id}` }],
        [{ text: '🔄 Kita tema', callback_data: `new:${id}` }, { text: '❌ Atmesti', callback_data: `no:${id}` }],
      ]
      : [
        [{ text: '✅ Patvirtinti (kitas laikas)', callback_data: `ok:${id}` }, { text: '⚡ Publikuoti dabar', callback_data: `now:${id}` }],
        [{ text: '🔄 Kita tema', callback_data: `new:${id}` }, { text: '❌ Atmesti', callback_data: `no:${id}` }],
      ],
  },
});

/** Semi-automatic mode: everything needed to post by hand, in two messages. */
export async function sendReadyPackage(files, caption, title) {
  await sendAlbum(files);
  await sendText(`📲 <b>${e(title)}</b> paruoštas įkėlimui.\n\n1. Išsaugok visas ${files.length} nuotraukas (ilgai paspausk albumą → Save).\n2. Instagram'e sukurk naują įrašą, pažymėk jas iš eilės.\n3. Nukopijuok aprašymą žemiau (paspausk ant jo) ir įklijuok.`);
  await sendText(`<pre>${e(caption)}</pre>`);
}

/** The review card: caption, critic flags, link check, and how to request edits. */
const clip = (t, n) => (String(t).length > n ? String(t).slice(0, n - 1) + '…' : String(t));

/** Kept under Telegram's 4096-character limit by trimming each section, never the markup. */
export function reviewCard(id, post, review, links = [], tight = false) {
  const flags = review.issues.filter((x) => x.severity !== 'low').slice(0, tight ? 3 : 5);
  const lows = review.issues.filter((x) => x.severity === 'low').length;
  const sev = { high: '🔴', medium: '🟡', low: '⚪' };
  const lines = [
    `<b>${e(post.title)}</b>  <i>(${e(post.engine)})</i>`,
    `ID: <code>${id}</code>`,
    '',
    '<b>Aprašymas:</b>',
    `<blockquote>${e(clip(post.caption, tight ? 600 : 1300))}${post.credits ? `\n\n${e(clip(post.credits, tight ? 150 : 300))}` : ''}</blockquote>`,
  ];
  if (flags.length) {
    lines.push('', '<b>Ekspertinė patikra:</b>');
    for (const f of flags) lines.push(`${sev[f.severity]} ${e(f.where)}: ${e(clip(f.problem, 140))}\n   → ${e(clip(f.fix, 140))}`);
  } else {
    lines.push('', '✔️ Ekspertinė patikra: rimtų pastabų nėra.');
  }
  if (lows) lines.push(`<i>(+${lows} smulkios stiliaus pastabos)</i>`);
  if (post.risk_notes?.length) {
    lines.push('', '<b>Ką gali kvestionuoti komentaruose:</b>');
    for (const r of post.risk_notes.slice(0, tight ? 2 : 3)) lines.push(`• ${e(clip(r, 140))}`);
  }
  if (links.length) {
    lines.push('', '<b>Nuorodų patikra:</b>');
    for (const l of links.slice(0, tight ? 4 : 8)) lines.push(`${l.ok ? '✅' : '❌'} ${e(clip(l.url, 80))} (${e(String(l.status))})`);
  }
  lines.push('', '✏️ <i>Norėdamas pataisyti, atsakyk (Reply) į šią žinutę, pvz.: „4 skaidrėje pakeisk knygą į Kindleberger“ arba „trumpiau, sausiau“.</i>');
  const card = lines.join('\n');
  return card.length > 3900 && !tight ? reviewCard(id, post, review, links, true) : card;
}

export async function getUpdates(offset, waitSeconds = 0) {
  const res = await http(api('getUpdates'), {
    method: 'POST',
    json: { offset, timeout: waitSeconds, allowed_updates: ['message', 'callback_query'] },
    timeout: (waitSeconds + 20) * 1000,
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram getUpdates: ${data.description}`);
  return data.result;
}

/** getUpdates silently returns nothing while a webhook is set, so clear any stray one. */
export async function ensurePolling() {
  const info = await call('getWebhookInfo', {});
  if (info.url) { await call('deleteWebhook', {}); return `removed webhook ${info.url}`; }
  return `polling ok, ${info.pending_update_count ?? 0} pending`;
}

export const answer = (callbackId, text) => call('answerCallbackQuery', { callback_query_id: callbackId, text }).catch(() => {});
export const clearButtons = (messageId) => call('editMessageReplyMarkup', { chat_id: chatId(), message_id: messageId, reply_markup: { inline_keyboard: [] } }).catch(() => {});
export const esc = (t) => e(t);
export const isOwner = (chat) => String(chat?.id) === String(chatId());

/** A single status message that is edited as work progresses, so you can see the bot is busy. */
export async function statusMessage(text) {
  const msg = await sendText(text).catch(() => null);
  let last = text;
  return {
    update: async (t) => {
      if (!msg || t === last) return;
      last = t;
      await call('editMessageText', { chat_id: chatId(), message_id: msg.message_id, text: t, parse_mode: 'HTML' }).catch(() => {});
      await call('sendChatAction', { chat_id: chatId(), action: 'typing' }).catch(() => {});
    },
  };
}
