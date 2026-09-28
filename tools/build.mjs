// בונה את index.html מתוך src/: מתרגם JSX מראש (esbuild) ומייצר CSS של Tailwind מראש.
// כך הדפדפן לא מוריד Babel ו-Tailwind (כמה מגה-בייט) ולא מתרגם קוד בכל פתיחה.
// הרצה: npm run build
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';

const root = new URL('..', import.meta.url).pathname;
// מאגדים את src/app.jsx יחד עם הקבצים שהוא מייבא (למשל רשימת ספרי הפתיחה). React ו-ReactDOM גלובליים מה-CDN.
const bundled = await build({
  entryPoints: [root + 'src/app.jsx'], bundle: true, write: false,
  loader: { '.jsx': 'jsx', '.js': 'js' }, jsx: 'transform', jsxFactory: 'React.createElement', jsxFragment: 'React.Fragment',
  format: 'iife', target: 'es2019', minify: true, legalComments: 'none', charset: 'utf8'
});
const code = bundled.outputFiles[0].text;
const css = execFileSync(root + 'node_modules/.bin/tailwindcss',
  ['-c', root + 'tailwind.config.cjs', '-i', root + 'tools/tailwind.css', '--minify'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
// גופנים מקומיים (במקום Google Fonts): מהיר יותר, עובד גם בלי אינטרנט. מעתיקים רק עברית ולטינית במשקלים בשימוש.
import { mkdirSync, copyFileSync } from 'node:fs';
const FONTS = { 'Frank Ruhl Libre': ['frank-ruhl-libre', [400, 500, 700]], 'Assistant': ['assistant', [400, 500, 600, 700]] };
const RANGES = { hebrew: 'U+0307-0308, U+0590-05FF, U+200C-2010, U+20AA, U+25CC, U+FB1D-FB4F', latin: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD' };
mkdirSync(root + 'fonts', { recursive: true });
let fontCss = '';
for (const [family, [pkg, weights]] of Object.entries(FONTS)) {
  for (const w of weights) for (const [subset, range] of Object.entries(RANGES)) {
    const file = `${pkg}-${subset}-${w}-normal.woff2`;
    copyFileSync(`${root}node_modules/@fontsource/${pkg}/files/${file}`, `${root}fonts/${file}`);
    fontCss += `@font-face{font-family:"${family}";font-style:normal;font-display:swap;font-weight:${w};src:url(fonts/${file}) format("woff2");unicode-range:${range}}`;
  }
}
const tpl = readFileSync(root + 'src/index.template.html', 'utf8');
if (!tpl.includes('/*__APP__*/') || !tpl.includes('/*__TAILWIND__*/')) throw new Error('template placeholders missing');
// "</script" בתוך הקוד היה סוגר את התגית מוקדם; esbuild לא מייצר כזה, אבל מוודאים
const safe = code.replace(/<\/script/gi, '<\\/script');
const html = '<!-- קובץ שנוצר אוטומטית מ-src/ ע"י tools/build.mjs. לעריכה: src/app.jsx ו-src/index.template.html -->\n' +
  tpl.replace('/*__TAILWIND__*/', () => fontCss + css).replace('/*__APP__*/', () => safe);
writeFileSync(root + 'index.html', html);
console.log(`index.html: ${(html.length / 1024).toFixed(0)} KB (app ${(safe.length / 1024).toFixed(0)} KB, css ${(css.length / 1024).toFixed(0)} KB)`);
