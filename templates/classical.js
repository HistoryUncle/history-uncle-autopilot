import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { p, roman, escapeHtml as e } from '../src/lib/util.js';

/**
 * History Uncle "classical" carousel template. 1080 x 1350.
 * Monochrome: all type and rules are white. The fade under the text is tinted from the
 * image itself (a deep shade of its own lower half) and gets stronger on bright images,
 * so white text stays legible on marble, sky or candlelight alike.
 * Lora for display, Inter for body, Roman numeral markers, "history uncle co." footer.
 */

const font = (pkg, file) => pathToFileURL(p('node_modules', '@fontsource', pkg, 'files', file)).href;

const FONTS = `
@font-face{font-family:Lora;font-weight:400;font-style:normal;src:url(${font('lora', 'lora-latin-400-normal.woff2')})}
@font-face{font-family:Lora;font-weight:400;font-style:italic;src:url(${font('lora', 'lora-latin-400-italic.woff2')})}
@font-face{font-family:Lora;font-weight:600;font-style:normal;src:url(${font('lora', 'lora-latin-600-normal.woff2')})}
@font-face{font-family:Lora;font-weight:600;font-style:italic;src:url(${font('lora', 'lora-latin-600-italic.woff2')})}
@font-face{font-family:Inter;font-weight:400;src:url(${font('inter', 'inter-latin-400-normal.woff2')})}
@font-face{font-family:Inter;font-weight:500;src:url(${font('inter', 'inter-latin-500-normal.woff2')})}
@font-face{font-family:Inter;font-weight:600;src:url(${font('inter', 'inter-latin-600-normal.woff2')})}
`;

const CSS = `
${FONTS}
*{margin:0;padding:0;box-sizing:border-box}
:root{--w:#FFFFFF;--w90:rgba(255,255,255,.92);--w70:rgba(255,255,255,.72);--w50:rgba(255,255,255,.52);--w30:rgba(255,255,255,.3)}
body{background:#000;width:1080px}
.slide{position:relative;width:1080px;height:1350px;overflow:hidden;background:#141414;color:var(--w);font-family:Inter,sans-serif;-webkit-font-smoothing:antialiased}

/* image */
.art{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:50% 30%;filter:saturate(.78) contrast(1.04)}
.art.blurbg{filter:blur(36px) saturate(.6) brightness(.6);transform:scale(1.2)}
.framed{position:absolute;left:50%;top:132px;transform:translateX(-50%);width:auto;height:auto;max-width:936px;max-height:760px;
  box-shadow:0 30px 80px rgba(0,0,0,.45),0 0 0 1px rgba(255,255,255,.08)}
.photo .art:not(.blurbg){filter:saturate(.7) contrast(1.02) brightness(.97)}
.noart{position:absolute;inset:0;background:radial-gradient(ellipse 70% 55% at 60% 30%,#3a3a3a 0%,transparent 70%),linear-gradient(160deg,#262626 0%,#141414 70%)}
.grain{position:absolute;inset:0;opacity:.06;mix-blend-mode:overlay;
  background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")}
.fade{position:absolute;inset:0}
.has-frame .fade{z-index:1}.has-frame .framed{z-index:2}.has-frame .block,.has-frame .foot,.has-frame .mast,.has-frame .credit{z-index:3}
.vignette{position:absolute;inset:0;box-shadow:inset 0 0 200px rgba(0,0,0,.4)}
.block,.mast,.foot{text-shadow:0 1px 28px rgba(0,0,0,.28)}

/* chrome */
.mast{position:absolute;top:66px;left:84px;right:84px;display:flex;align-items:center;gap:22px;
  font:500 19px/1 Inter;letter-spacing:.34em;text-transform:uppercase;color:var(--w90)}
.mast .rule{flex:0 0 42px;height:1px;background:var(--w70)}
.foot{position:absolute;left:84px;right:84px;bottom:58px;display:flex;justify-content:space-between;align-items:center;
  font:400 19px/1 Inter;letter-spacing:.16em;color:var(--w50)}
.foot .swipe{display:flex;align-items:center;gap:14px;letter-spacing:.26em;text-transform:uppercase;font-size:17px;color:var(--w70)}
.foot .swipe i{display:block;width:50px;height:1px;background:var(--w70);position:relative}
.foot .swipe i:after{content:"";position:absolute;right:0;top:-4.5px;width:9px;height:9px;border-top:1px solid var(--w70);border-right:1px solid var(--w70);transform:rotate(45deg)}
.credit{position:absolute;right:30px;top:50%;transform:translateY(-50%) rotate(180deg);writing-mode:vertical-rl;
  font:400 13px/1 Inter;letter-spacing:.1em;color:rgba(255,255,255,.4);max-height:1000px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* minimal cover: brand mark on top, centred title at the bottom */
.cover .brandmark{position:absolute;top:72px;left:50%;transform:translateX(-50%);width:250px;height:auto;opacity:.95;filter:drop-shadow(0 2px 14px rgba(0,0,0,.6)) drop-shadow(0 0 40px rgba(0,0,0,.45));z-index:3}
.cover .block{left:90px;right:90px;bottom:118px;text-align:center}
.cover .title{font:500 92px/1.04 Lora;letter-spacing:.035em;text-wrap:balance}
.cover.has-frame .framed{top:190px}

/* text block */
.block{position:absolute;left:84px;right:96px;bottom:150px}
.kicker{font:500 21px/1 Inter;letter-spacing:.34em;text-transform:uppercase;color:var(--w70);margin-bottom:30px}
.title{font:600 96px/1.02 Lora;text-transform:uppercase;letter-spacing:.01em;text-wrap:balance}
.hair{width:96px;height:1px;background:var(--w70);margin:40px 0 30px}
.dek{font:italic 400 36px/1.32 Lora;color:var(--w90);max-width:860px;text-wrap:pretty}

.num{font:italic 400 60px/1 Lora;color:var(--w90);margin-bottom:24px;display:flex;align-items:center;gap:22px}
.num .rule{width:56px;height:1px;background:var(--w50)}
.flag{display:inline-block;font:500 16px/1 Inter;letter-spacing:.24em;text-transform:uppercase;color:var(--w90);
  border:1px solid var(--w50);padding:9px 14px 8px;margin-bottom:24px}
.heading{font:600 60px/1.1 Lora;letter-spacing:-.005em;margin-bottom:26px;text-wrap:balance}
.body{font:400 36px/1.42 Inter;color:var(--w90);max-width:880px;text-wrap:pretty}
.body em{font-style:italic;font-family:Lora,serif;font-size:1.04em}
.source{margin-top:26px;font:italic 400 24px/1.3 Lora;color:var(--w50)}

/* CTA: minimal end card */
.cta{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
.cta .frame{position:absolute;inset:44px;border:1px solid var(--w30)}
.slide.cta .art{filter:saturate(.3) brightness(.28) blur(6px) !important;transform:scale(1.08)}
.cta .logo{width:112px;height:112px;object-fit:contain;margin-bottom:64px;opacity:.95}
.cta .url{font:italic 400 64px/1.1 Lora;color:var(--w);letter-spacing:-.005em}
.cta .hair{width:96px;height:1px;background:var(--w50);margin:52px auto 44px}
.cta .bio{font:500 22px/1 Inter;letter-spacing:.42em;text-transform:uppercase;color:var(--w70);padding-left:.42em}
`;

/**
 * Images are inlined as data URLs so the page script can sample their colours.
 * fit "fill": cropped to the slide around the art director's focus point.
 * fit "frame": the whole work shown uncropped near the top, over a blurred copy of itself.
 */
const artImg = (dir, art, { bgOnly = false } = {}) => {
  if (!art?.file) return '<div class="noart"></div>';
  const src = `data:image/jpeg;base64,${fs.readFileSync(path.join(dir, art.file)).toString('base64')}`;
  if (bgOnly) return `<img class="art" src="${src}">`;
  if (art.fit === 'frame') return `<img class="art blurbg" src="${src}"><img class="framed" src="${src}">`;
  const [x, y] = art.focus ?? [0.5, 0.35];
  return `<img class="art" src="${src}" style="object-position:${Math.round(x * 100)}% ${Math.round(y * 100)}%">`;
};

const credit = (art) => art ? `<div class="credit">${e(art.artist)}${art.title ? `, ${e(art.title)}` : ''}${art.date ? `, ${e(art.date)}` : ''}</div>` : '';

/** Brand images from assets/ (logos), inlined; missing files are simply skipped. */
const asset = (rel, cls) => {
  const file = rel ? p(rel) : null;
  if (!file || !fs.existsSync(file)) return '';
  const type = path.extname(file) === '.svg' ? 'svg+xml' : 'png';
  return `<img class="${cls}" src="data:image/${type};base64,${fs.readFileSync(file).toString('base64')}">`;
};

export function buildHtml(post, dir, brand) {
  const foot = () => `<div class="foot"><span>${e(brand.footer)}</span><span></span></div>`;
  const md = (s) => e(s).replace(/\*([^*]+)\*/g, '<em>$1</em>'); // *Book Title* -> italic
  const kind = post.visual_style === 'photo' ? 'photo' : 'painting';

  const cover = `
  <section class="slide cover ${kind}${post.coverArt?.fit === 'frame' ? ' has-frame' : ''}">
    ${artImg(dir, post.coverArt)}<div class="grain"></div><div class="fade"></div><div class="vignette"></div>
    ${asset(brand.cover_logo, 'brandmark')}
    <div class="block">
      <h1 class="title fit" data-min="60">${e(post.title)}</h1>
    </div>
  </section>`;

  const slides = post.slides.map((s, i) => `
  <section class="slide ${kind}${s.art?.fit === 'frame' ? ' has-frame' : ''}">
    ${artImg(dir, s.art)}<div class="grain"></div><div class="fade"></div><div class="vignette"></div>
    <div class="block">
      <div class="num">${roman(i + 1)}<span class="rule"></span></div>
      <h2 class="heading">${e(s.heading)}</h2>
      <p class="body fit" data-min="30">${md(s.body)}</p>
    </div>
    ${foot()}
  </section>`).join('');

  const cta = brand.slides.include_cta_slide ? `
  <section class="slide cta ${kind}">
    ${artImg(dir, post.coverArt, { bgOnly: true })}<div class="frame"></div>
    <div style="position:relative;display:flex;flex-direction:column;align-items:center">
      ${asset(brand.cta_logo, 'logo')}
      <div class="url">${e(brand.substack_display)}</div>
      <div class="hair"></div>
      <div class="bio">Link in bio</div>
    </div>
    <div class="foot"><span>${e(brand.footer)}</span><span></span></div>
  </section>` : '';

  const script = `
  <script>
  // Tint the fade with a deep shade of the image's own lower half; push harder on bright images.
  function adapt(slide) {
    const img = slide.querySelector('img.art'); const fade = slide.querySelector('.fade');
    if (!fade) return;
    let tone = [20, 20, 20], bright = 0.3, topBright = 0.3;
    if (img) {
      const c = document.createElement('canvas'); c.width = 40; c.height = 50;
      const x = c.getContext('2d');
      const r = img.naturalWidth / img.naturalHeight, R = 1080 / 1350;
      let sw = img.naturalWidth, sh = img.naturalHeight, sx = 0, sy = 0;
      if (r > R) { sw = sh * R; sx = (img.naturalWidth - sw) / 2; } else { sh = sw / R; sy = (img.naturalHeight - sh) * 0.3; }
      x.drawImage(img, sx, sy, sw, sh, 0, 0, 40, 50);
      const d = x.getImageData(0, 0, 40, 50).data;
      const avg = (y0, y1) => { let s = [0, 0, 0], n = 0; for (let y = y0; y < y1; y++) for (let k = 0; k < 40; k++) { const i = (y * 40 + k) * 4; s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; n++; } return s.map(v => v / n); };
      const lum = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
      const low = avg(25, 50), top = avg(0, 8);
      bright = lum(low); topBright = lum(top);
      const gray = (low[0] + low[1] + low[2]) / 3;
      const muted = low.map(v => v * 0.6 + gray * 0.4);           // keep the hue, drop saturation
      const k = 0.075 / Math.max(lum(muted), 0.01);               // scale to a deep shade
      tone = muted.map(v => Math.round(Math.min(255, v * Math.min(k, 1))));
    }
    const s = Math.max(0, Math.min(1, (bright - 0.22) / 0.5));
    const t = tone.join(','); const cover = slide.classList.contains('cover');
    const start = (cover ? 44 : 34) - 10 * s, mid = (cover ? 64 : 54) - 6 * s;
    // the cover carries the logo at the top, so it always gets a firmer top shade
    const topA = cover ? Math.min(0.78, 0.55 + 0.4 * Math.max(0, topBright - 0.3)) : Math.min(0.6, 0.25 + 0.5 * Math.max(0, topBright - 0.35));
    const topEnd = cover ? 24 : 16;
    fade.style.background = 'linear-gradient(180deg,rgba(' + t + ',' + topA + ') 0%,rgba(' + t + ',' + (cover ? topA * 0.45 : 0) + ') ' + (topEnd * 0.55) + '%,rgba(' + t + ',0) ' + topEnd + '%,rgba(' + t + ',0) ' + start + '%,rgba(' + t + ',' + (0.6 + 0.3 * s) + ') ' + mid + '%,rgba(' + t + ',.95) ' + (mid + 16) + '%,rgb(' + t + ') 92%)';
    slide.style.background = 'rgb(' + t + ')';
  }
  Promise.all([document.fonts.ready, ...[...document.images].map(i => i.decode().catch(() => {}))]).then(() => {
    document.querySelectorAll('section.slide:not(.cta)').forEach(adapt);
    for (const el of document.querySelectorAll('.fit')) {
      const block = el.closest('.block'); const slide = el.closest('.slide');
      const min = +el.dataset.min || 28;
      let size = parseFloat(getComputedStyle(el).fontSize);
      const tooTall = () => block.getBoundingClientRect().top - slide.getBoundingClientRect().top < 150;
      while (tooTall() && size > min) { size -= 2; el.style.fontSize = size + 'px'; }
    }
    // framed works sit between the masthead and the text block
    for (const slide of document.querySelectorAll('.has-frame')) {
      const img = slide.querySelector('.framed'); const block = slide.querySelector('.block');
      const room = block.getBoundingClientRect().top - slide.getBoundingClientRect().top - 132 - 56;
      img.style.maxHeight = Math.max(360, room) + 'px';
    }
    document.body.dataset.ready = '1';
  });
  </script>`;

  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${cover}${slides}${cta}${script}</body></html>`;
}
