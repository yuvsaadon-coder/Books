// מייצר את קבצי ה-PNG של האייקון מתוך קבצי ה-SVG שב-icons/ (דורש את התלויות של tests/)
import { chromium } from '../tests/node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';
const dir = new URL('../icons/', import.meta.url).pathname;
const jobs = [['favicon.svg', 'icon-192.png', 192], ['favicon.svg', 'icon-512.png', 512], ['favicon.svg', 'favicon-32.png', 32], ['favicon.svg', 'favicon-16.png', 16],
  ['maskable.svg', 'maskable-512.png', 512], ['maskable.svg', 'maskable-192.png', 192], ['apple.svg', 'apple-touch-icon.png', 180]];
const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
for (const [src, out, size] of jobs) {
  const p = await b.newPage({ viewport: { width: size, height: size } });
  await p.setContent(`<body style="margin:0;background:transparent">${readFileSync(dir + src, 'utf8').replace('<svg ', `<svg width="${size}" height="${size}" `)}</body>`);
  await p.screenshot({ path: dir + out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  await p.close();
}
await b.close();
console.log('icons written');
