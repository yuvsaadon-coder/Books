// בונה את index.html מתוך src/: מתרגם JSX מראש (esbuild) ומייצר CSS של Tailwind מראש.
// כך הדפדפן לא מוריד Babel ו-Tailwind (כמה מגה-בייט) ולא מתרגם קוד בכל פתיחה.
// הרצה: npm run build
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { transform } from 'esbuild';

const root = new URL('..', import.meta.url).pathname;
const src = readFileSync(root + 'src/app.jsx', 'utf8');
const { code } = await transform(src, {
  loader: 'jsx', jsx: 'transform', jsxFactory: 'React.createElement', jsxFragment: 'React.Fragment',
  format: 'iife', target: 'es2019', minify: true, legalComments: 'none', charset: 'utf8'
});
const css = execFileSync(root + 'node_modules/.bin/tailwindcss',
  ['-c', root + 'tailwind.config.cjs', '-i', root + 'tools/tailwind.css', '--minify'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const tpl = readFileSync(root + 'src/index.template.html', 'utf8');
if (!tpl.includes('/*__APP__*/') || !tpl.includes('/*__TAILWIND__*/')) throw new Error('template placeholders missing');
// "</script" בתוך הקוד היה סוגר את התגית מוקדם; esbuild לא מייצר כזה, אבל מוודאים
const safe = code.replace(/<\/script/gi, '<\\/script');
const html = '<!-- קובץ שנוצר אוטומטית מ-src/ ע"י tools/build.mjs. לעריכה: src/app.jsx ו-src/index.template.html -->\n' +
  tpl.replace('/*__TAILWIND__*/', () => css).replace('/*__APP__*/', () => safe);
writeFileSync(root + 'index.html', html);
console.log(`index.html: ${(html.length / 1024).toFixed(0)} KB (app ${(safe.length / 1024).toFixed(0)} KB, css ${(css.length / 1024).toFixed(0)} KB)`);
