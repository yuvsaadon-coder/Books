// תרגום הממשק לאנגלית: כל טקסט שמוצג למשתמש (ש-tools/i18n.mjs עוטף ב-L()) חייב תרגום ב-src/i18n-en.js,
// ולכל ספר ברשימת ההיכרות יש שם ומחבר באנגלית (src/starter-en.js)
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { collectKeyLines, translateSource } from '../tools/i18n.mjs';
import { EN } from '../src/i18n-en.js';
import { STARTER } from '../src/starter-books.js';
import { STARTER_EN } from '../src/starter-en.js';
import { parse } from '@babel/parser';

const src = readFileSync(new URL('../src/app.jsx', import.meta.url), 'utf8');
const keys = collectKeyLines(src);
const missing = keys.filter(([k]) => !(k in EN) && !(k.trim() in EN));
assert.deepEqual(missing.map(([k, l]) => `${l}: ${k}`), [], 'missing English translations');
// משתנים: אותם {0}, {1} במקור ובתרגום
const vars = (s) => (s.match(/\{\d+\}/g) || []).sort().join();
const badVars = keys.filter(([k]) => EN[k] !== undefined && vars(k) !== vars(EN[k]));
assert.deepEqual(badVars.map(([k]) => k), [], 'placeholders differ between Hebrew and English');
// אין עברית בתרגום (חוץ מבחירת השפה, שבה "עברית" כתובה בעברית בכוונה)
const heInEn = Object.entries(EN).filter(([k, v]) => /[֐-׿]/.test(v) && !/שפה · Language|עברית \(Hebrew\)/.test(v));
assert.deepEqual(heInEn.map(([k]) => k), [], 'Hebrew inside English translations');
// הקוד אחרי העטיפה עדיין תקין
parse(translateSource(src), { sourceType: 'module', plugins: ['jsx'] });
// רשימת ההיכרות
const deck = STARTER.flatMap(g => g.books);
const noEn = deck.filter(b => !STARTER_EN[b[0] + '|' + b[1]] || STARTER_EN[b[0] + '|' + b[1]].some(x => !x || /[֐-׿]/.test(x)));
assert.deepEqual(noEn.map(b => b[0]), [], 'starter books without English names');
STARTER.forEach(g => assert.ok(EN[g.genre], 'genre name: ' + g.genre));
console.log(`i18n: ok (${keys.length} texts, ${deck.length} starter books)`);
