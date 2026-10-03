// תרגום הממשק לאנגלית בזמן הבנייה: כל טקסט עברי שמוצג למשתמש עובר דרך L() בלי לגעת בקוד המקור.
// - טקסט בתוך JSX:            <p>שלום</p>                → <p>{L("שלום")}</p>
// - מאפייני תצוגה:            aria-label="סגירה"          → aria-label={L("סגירה")}
// - מחרוזת במקום תצוגה:       {x ? 'כן' : 'לא'}            → {x ? L("כן") : L("לא")}
// - תבנית עם משתנים:          `נמצאו ${n} ספרים`           → L("נמצאו {0} ספרים", [n])
// - ארגומנט לפונקציות ממשק:   notify('נשמר'), T('…'), gx(…), onProgress(…)
// טקסט שמוגדר מחוץ למקומות האלה (רשימות קבועות וכו') עטוף במקור ב-L() במפורש.
// המילון: src/i18n-en.js (מפתח = הטקסט העברי, בלשון רבים לפני T()). הבדיקה tests/i18n.mjs מוודאת שאין חסרים.
import { parse } from '@babel/parser';

const HE = /[֐-׿]/;
export const ATTRS = new Set(['aria-label', 'label', 'placeholder', 'title', 'summary', 'alt']);
export const CALLS = new Set(['T', 'gx', 'notify', 'setErr', 'onProgress', 'progress', 'push', 'say', 'setMsg', 'T3', 'L']);

// React מנקה רווחים ב-JSX: שורות נחתכות, שורות ריקות נעלמות, שבירות שורה הופכות לרווח
function jsxClean(raw) {
  const lines = raw.split(/\r\n|\n|\r/);
  let out = '';
  lines.forEach((line, i) => {
    let l = line.replace(/\t/g, ' ');
    if (i > 0) l = l.replace(/^ +/, '');
    if (i < lines.length - 1) l = l.replace(/ +$/, '');
    if (l) { if (out) out += ' '; out += l; }
  });
  return out;
}
const lit = (s) => JSON.stringify(s);

// מחזיר את רשימת השינויים: [{start, end, make(render)}]
function collect(ast, src, keys) {
  let curLine = 0;
  const add0 = keys && keys.add.bind(keys);
  if (keys && keys.lines) keys.add = (k) => { add0(k); if (!keys.lines.has(k)) keys.lines.set(k, curLine); return keys; };
  const edits = [];
  const keyOfTemplate = (n) => n.quasis.map((q, i) => q.value.cooked + (i < n.expressions.length ? `{${i}}` : '')).join('');
  const wrapLiteral = (n) => {
    if (n.type === 'StringLiteral') {
      if (!HE.test(n.value)) return;
      keys && keys.add(n.value);
      edits.push({ start: n.start, end: n.end, make: () => `L(${lit(n.value)})` });
    } else if (n.type === 'TemplateLiteral') {
      const key = keyOfTemplate(n);
      if (!HE.test(key)) return;
      keys && keys.add(key);
      edits.push({ start: n.start, end: n.end, make: (render) => n.expressions.length ? `L(${lit(key)}, [${n.expressions.map(e => render(e.start, e.end)).join(', ')}])` : `L(${lit(key)})` });
    }
  };
  // מטפס מהמחרוזת למעלה דרך תנאים וחיבורים; אם מגיעים לתצוגה (ילד JSX, מאפיין תצוגה או קריאה לפונקציית ממשק) – מתרגמים
  const inDisplay = (path) => {
    const r = inDisplay0(path);
    if (r && viaColl && process.env.I18N_DEBUG) console.log('via-collection', path[path.length - 1].loc.start.line, JSON.stringify(path[path.length - 1].value || '').slice(0, 70));
    return r;
  };
  let viaColl = false;
  const inDisplay0 = (path) => {
    viaColl = false;
    for (let i = path.length - 1; i > 0; i--) {
      const node = path[i], parent = path[i - 1];
      if (parent.type === 'ConditionalExpression' && parent.test !== node) continue;
      if (parent.type === 'LogicalExpression') continue;
      if (parent.type === 'TemplateLiteral') continue;   // תבנית בתוך תבנית: מתורגמת אם החיצונית בתצוגה
      // רשימה או אובייקט שנבנים בתוך JSX ומוצגים: {[['a', 'טקסט']].map(...)} או {{ want: 'טקסט' }[status]}
      if (parent.type === 'ArrayExpression' || parent.type === 'ObjectExpression') { viaColl = true; continue; }
      if (parent.type === 'ObjectProperty' && parent.value === node) continue;
      if (parent.type === 'MemberExpression' && parent.object === node) continue;
      if (parent.type === 'CallExpression' && parent.callee === node) continue;
      if (parent.type === 'BinaryExpression' && parent.operator === '+') continue;
      if (parent.type === 'JSXExpressionContainer') {
        const gp = path[i - 2];
        if (!gp) return false;
        if (gp.type === 'JSXElement' || gp.type === 'JSXFragment') return true;
        if (gp.type === 'JSXAttribute') return ATTRS.has(gp.name.name);
        return false;
      }
      if (parent.type === 'NewExpression' && parent.arguments.includes(node)) return parent.callee.type === 'Identifier' && parent.callee.name === 'Error';
      if (parent.type === 'CallExpression' && parent.arguments.includes(node)) {
        const c = parent.callee; const name = c.type === 'Identifier' ? c.name : c.type === 'MemberExpression' && c.property.type === 'Identifier' ? c.property.name : '';
        return CALLS.has(name) && name !== 'L' && !viaColl;   // push({ q: 'רומן' }) הוא נתון, לא טקסט
      }
      return false;
    }
    return false;
  };
  const walk = (n, path) => {
    if (!n || typeof n.type !== 'string') return;
    if (n.loc) curLine = n.loc.start.line;
    path.push(n);
    if (n.type === 'JSXText' && HE.test(n.value)) {
      const clean = jsxClean(n.value);
      const key = clean.trim();
      if (key) {
        keys && keys.add(key);
        const lead = clean.match(/^ */)[0], trail = clean.match(/ *$/)[0];
        edits.push({ start: n.start, end: n.end, make: () => `{${lead ? `${lit(lead)} + ` : ''}L(${lit(key)})${trail ? ` + ${lit(trail)}` : ''}}` });
      }
    } else if (n.type === 'JSXAttribute' && n.value && n.value.type === 'StringLiteral' && ATTRS.has(n.name.name) && HE.test(n.value.value)) {
      keys && keys.add(n.value.value);
      edits.push({ start: n.value.start, end: n.value.end, make: () => `{L(${lit(n.value.value)})}` });
    } else if ((n.type === 'StringLiteral' || n.type === 'TemplateLiteral') && inDisplay(path)) {
      wrapLiteral(n);
      if (n.type === 'TemplateLiteral') n.expressions.forEach(e => walk(e, path));
      path.pop(); return;
    } else if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === 'L' && n.arguments[0]) {
      // L() מפורש במקור: רק אוספים את המפתח
      const a = n.arguments[0];
      if (a.type === 'StringLiteral') keys && keys.add(a.value);
      else if (a.type === 'TemplateLiteral') { if (a.expressions.length) throw new Error(`L() with a template literal at ${a.loc.start.line}: use L('… {0} …', [x])`); keys && keys.add(a.quasis[0].value.cooked); }
      n.arguments.slice(1).forEach(x => walk(x, path));
      path.pop(); return;
    }
    for (const k of Object.keys(n)) {
      if (k === 'loc' || k === 'start' || k === 'end' || k === 'extra' || k === 'leadingComments' || k === 'trailingComments' || k === 'innerComments') continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach(c => walk(c, path)); else if (v && typeof v.type === 'string') walk(v, path);
    }
    path.pop();
  };
  walk(ast.program, []);
  return edits;
}

const parseSrc = (src) => parse(src, { sourceType: 'module', plugins: ['jsx'] });

export function translateSource(src) {
  const edits = collect(parseSrc(src), src, null).sort((a, b) => a.start - b.start || b.end - a.end);
  // שינויים מקוננים (משתנה בתוך תבנית שבעצמו מכיל טקסט) מוחלים בתוך ה-render של ההורה
  const render = (from, to) => {
    let out = '', pos = from;
    for (let i = 0; i < edits.length; i++) {
      const e = edits[i];
      if (e.start < pos || e.start >= to) continue;
      if (e.end > to) continue;
      out += src.slice(pos, e.start) + e.make(render);
      pos = e.end;
    }
    return out + src.slice(pos, to);
  };
  return render(0, src.length);
}

export function collectKeys(src) {
  const keys = new Set();
  collect(parseSrc(src), src, keys);
  return keys;
}

// מחרוזות עבריות שלא תורגמו (לא בתצוגה ולא ב-L) – לבדיקה ידנית
export function untranslated(src) {
  const ast = parseSrc(src);
  const edits = collect(ast, src, null);
  const covered = (n) => edits.some(e => e.start <= n.start && e.end >= n.end);
  const out = [];
  const walk = (n, parent) => {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === 'L') return;
    if ((n.type === 'StringLiteral' || n.type === 'TemplateLiteral') && !(parent && parent.type === 'JSXAttribute')) {
      const s = n.type === 'StringLiteral' ? n.value : n.quasis.map(q => q.value.cooked).join('{}');
      if (HE.test(s) && !covered(n)) out.push({ line: n.loc.start.line, s });
    }
    if (n.type === 'JSXAttribute' && n.value && n.value.type === 'StringLiteral' && HE.test(n.value.value) && !ATTRS.has(n.name.name)) out.push({ line: n.loc.start.line, s: `[${n.name.name}] ${n.value.value}` });
    for (const k of Object.keys(n)) {
      if (k === 'loc' || k === 'start' || k === 'end' || k === 'extra') continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach(c => walk(c, n)); else if (v && typeof v.type === 'string') walk(v, n);
    }
  };
  walk(ast.program, null);
  return out;
}

export function collectKeyLines(src) {
  const keys = new Set(); keys.lines = new Map();
  collect(parseSrc(src), src, keys);
  return [...keys.lines.entries()];
}
