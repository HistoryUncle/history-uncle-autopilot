import fs from 'node:fs';
import path from 'node:path';
import { publishMode, env, http, escapeHtml as e } from './lib/util.js';

/**
 * Telegram bot = your approval desk. No server needed: GitHub Actions polls getUpdates
 * every 15 minutes and acts on button presses and replies.
 */
const api = (method) => `https://api.telegram.org/bot${env('TELEGRAM_BOT_TOKEN')}/${method}`;
const chatId = () => env('TELEGRAM_CHAT_ID');

async function call(method, payload) {
  const res = await http(api(method), { method: 'POST', json: payload });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram ${method}: ${data.description}`);
  return data.result;
}

export const sendText = (text, extra = {}) =>
  call('sendMessage', { chat_id: chatId(), text: text.slice(0, 4096), parse_mode: 'HTML', disable_web_page_preview: true, ...extra });

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
export function reviewCard(id, post, review, links = []) {
  const flags = review.issues.filter((x) => x.severity !== 'low');
  const lows = review.issues.length - flags.length;
  const sev = { high: '🔴', medium: '🟡', low: '⚪' };
  const lines = [
    `<b>${e(post.title)}</b>  <i>(${e(post.engine)})</i>`,
    `ID: <code>${id}</code>`,
    '',
    '<b>Aprašymas:</b>',
    `<blockquote>${e(post.caption)}${post.credits ? `\n\n${e(post.credits)}` : ''}</blockquote>`,
  ];
  if (flags.length) {
    lines.push('', '<b>Ekspertinė patikra:</b>');
    for (const f of flags) lines.push(`${sev[f.severity]} ${e(f.where)}: ${e(f.problem)}\n   → ${e(f.fix)}`);
  } else {
    lines.push('', '✔️ Ekspertinė patikra: rimtų pastabų nėra.');
  }
  if (lows) lines.push(`<i>(+${lows} smulkios stiliaus pastabos)</i>`);
  if (post.risk_notes?.length) {
    lines.push('', '<b>Ką gali kvestionuoti komentaruose:</b>');
    for (const r of post.risk_notes) lines.push(`• ${e(r)}`);
  }
  if (links.length) {
    lines.push('', '<b>Nuorodų patikra:</b>');
    for (const l of links) lines.push(`${l.ok ? '✅' : '❌'} ${e(l.url)} (${e(String(l.status))})`);
  }
  lines.push('', '✏️ <i>Norėdamas pataisyti, atsakyk (Reply) į šią žinutę, pvz.: „4 skaidrėje pakeisk knygą į Kindleberger“ arba „trumpiau, sausiau“.</i>');
  return lines.join('\n');
}

export async function getUpdates(offset) {
  const res = await http(api('getUpdates'), { method: 'POST', json: { offset, timeout: 0, allowed_updates: ['message', 'callback_query'] } });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram getUpdates: ${data.description}`);
  return data.result;
}

export const answer = (callbackId, text) => call('answerCallbackQuery', { callback_query_id: callbackId, text }).catch(() => {});
export const clearButtons = (messageId) => call('editMessageReplyMarkup', { chat_id: chatId(), message_id: messageId, reply_markup: { inline_keyboard: [] } }).catch(() => {});
export const isOwner = (chat) => String(chat?.id) === String(chatId());
