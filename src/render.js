import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { brand, log } from './lib/util.js';
import { buildHtml } from '../templates/classical.js';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);

const chromePath = () => {
  const found = CHROME_CANDIDATES.find((c) => fs.existsSync(c));
  if (!found) throw new Error('Chrome not found. Set CHROME_PATH.');
  return found;
};

/** Render every slide to dir/slides/NN.jpg (JPEG: the format Instagram's API expects). */
export async function render(post, dir, outName = 'slides') {
  const b = brand();
  const html = buildHtml(post, dir, b);
  const htmlFile = path.join(dir, 'carousel.html');
  fs.writeFileSync(htmlFile, html);
  const outDir = path.join(dir, outName);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: true,
    args: ['--no-sandbox', '--allow-file-access-from-files', '--font-render-hinting=none'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1350, deviceScaleFactor: 1 });
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) log('page:', m.text()); });
    page.on('pageerror', (err) => log('page error:', err.message));
    await page.goto('file://' + htmlFile, { waitUntil: 'networkidle0' });
    await page.waitForSelector('body[data-ready="1"]', { timeout: 90000 });
    const slides = await page.$$('section.slide');
    const files = [];
    for (let i = 0; i < slides.length; i++) {
      const file = path.join(outDir, `${String(i + 1).padStart(2, '0')}.jpg`);
      await slides[i].screenshot({ path: file, type: 'jpeg', quality: 92 });
      files.push(file);
    }
    log(`rendered ${files.length} slides`);
    return files;
  } finally {
    await browser.close();
  }
}
