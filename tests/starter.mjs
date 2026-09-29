// בדיקת רשימת הפתיחה: 400 ספרים, ז'אנרים מאוזנים (הפרש של עד 10), בלי כפילויות
import assert from 'node:assert/strict';
import { STARTER } from '../src/starter-books.js';
const sizes = STARTER.map(g => g.books.length);
assert.equal(sizes.reduce((a, b) => a + b, 0), 400, 'total');
// הומור וקליל הם ז'אנרים נפרדים
assert.ok(STARTER.some(g => g.genre === 'הומור') && STARTER.some(g => g.tag === 'קליל'));
assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 10, 'balance ' + sizes);
const seen = new Set();
for (const g of STARTER) for (const b of g.books) {
  assert.ok(b[0] && b[1], 'title+author ' + b);
  const k = b[0].replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  assert.ok(!seen.has(k), 'duplicate ' + b[0]); seen.add(k);
}
console.log('starter list: ok', sizes.join(','));
