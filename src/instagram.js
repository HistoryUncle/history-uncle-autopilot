import { brand, env, http, log, sleep } from './lib/util.js';

/**
 * Instagram API with Instagram Login (graph.instagram.com).
 * Works for Creator/Business accounts; no Facebook Page needed.
 * Permissions: instagram_business_basic, instagram_business_content_publish,
 *              instagram_business_manage_comments, instagram_business_manage_messages
 */
const base = () => { const b = brand().instagram; return `${b.api_host}/${b.api_version}`; };
const token = () => env('IG_ACCESS_TOKEN');

async function ig(pathname, { method = 'GET', params = {}, json } = {}) {
  const url = new URL(`${base()}/${pathname}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await http(url.toString(), { method, headers: { Authorization: `Bearer ${token()}` }, json });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(`Instagram ${method} ${pathname}: ${JSON.stringify(data.error ?? data)}`);
  return data;
}

let cachedUser;
export async function me() {
  if (!cachedUser) cachedUser = await ig('me', { params: { fields: 'user_id,username' } });
  return cachedUser; // { user_id, username, id }
}
const userId = async () => process.env.IG_USER_ID || (await me()).user_id;

async function waitFinished(containerId) {
  for (let i = 0; i < 30; i++) {
    const { status_code } = await ig(containerId, { params: { fields: 'status_code' } });
    if (status_code === 'FINISHED') return;
    if (status_code === 'ERROR' || status_code === 'EXPIRED') throw new Error(`container ${containerId} ${status_code}`);
    await sleep(4000);
  }
  throw new Error(`container ${containerId} not ready after 2 minutes`);
}

/** imageUrls must be publicly reachable JPEGs (we serve them from the public GitHub repo). */
export async function publishCarousel(imageUrls, caption) {
  const uid = await userId();
  const children = [];
  for (const image_url of imageUrls.slice(0, 10)) {
    const c = await ig(`${uid}/media`, { method: 'POST', json: { image_url, is_carousel_item: true } });
    children.push(c.id);
  }
  for (const c of children) await waitFinished(c);
  const parent = await ig(`${uid}/media`, {
    method: 'POST',
    json: {
      media_type: 'CAROUSEL', children: children.join(','), caption,
      ...(brand().instagram.label_ai_generated ? { is_ai_generated: true } : {}),
    },
  });
  await waitFinished(parent.id);
  const pub = await ig(`${uid}/media_publish`, { method: 'POST', json: { creation_id: parent.id } });
  const media = await ig(pub.id, { params: { fields: 'id,permalink,timestamp' } });
  log(`published ${media.permalink}`);
  return media;
}

/** Comment-to-DM funnel: anyone who comments the keyword gets the Substack link privately. */
export async function runDmFunnel(state) {
  const cfg = brand().dm_funnel;
  if (!cfg.enabled) return 0;
  const uid = await userId();
  const { username } = await me();
  const kw = new RegExp(`\\b${cfg.keyword}\\b`, 'i');
  const replied = new Set(state.repliedComments);
  const weekAgo = Date.now() - 6.5 * 24 * 3600 * 1000; // private replies are allowed within 7 days

  const media = await ig(`${uid}/media`, { params: { fields: 'id,timestamp', limit: '12' } });
  let sent = 0;
  for (const m of media.data ?? []) {
    let page = await ig(`${m.id}/comments`, { params: { fields: 'id,text,timestamp,username', limit: '50' } });
    while (page) {
      for (const c of page.data ?? []) {
        if (replied.has(c.id) || c.username === username) continue;
        if (new Date(c.timestamp).getTime() < weekAgo) { replied.add(c.id); continue; }
        if (!kw.test(c.text ?? '')) continue;
        try {
          await ig(`${uid}/messages`, { method: 'POST', json: { recipient: { comment_id: c.id }, message: { text: cfg.dm_text } } });
          if (cfg.public_reply_enabled) await ig(`${c.id}/replies`, { method: 'POST', params: { message: cfg.public_reply } }).catch((e) => log('public reply failed', e.message));
          sent++;
          log(`DM sent to @${c.username}`);
        } catch (e) {
          log(`DM to @${c.username} failed: ${e.message}`);
        }
        replied.add(c.id);
        await sleep(1200);
      }
      const next = page.paging?.next;
      page = next ? await (await http(next, { headers: { Authorization: `Bearer ${token()}` } })).json() : null;
    }
  }
  state.repliedComments = [...replied];
  return sent;
}

/** Long-lived tokens last 60 days; refreshing returns a fresh 60-day token. */
export async function refreshToken() {
  const url = `${brand().instagram.api_host}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token())}`;
  const res = await http(url);
  const data = await res.json();
  if (!data.access_token) throw new Error(`refresh failed: ${JSON.stringify(data)}`);
  return data;
}
