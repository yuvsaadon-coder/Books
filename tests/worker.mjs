// בדיקות יחידה לשרת: הכלים שנשלחים ל-Anthropic
import assert from 'node:assert/strict';
import { sanitizeTools } from '../worker/worker.js';
const tools = sanitizeTools([
  { type: 'web_search_20260209', name: 'web_search' }, { type: 'web_fetch_20260209', name: 'web_fetch' },
  { name: 'submit_x', input_schema: { type: 'object' } }, { type: 'code_execution_20260521', name: 'code_execution' }
]);
assert.deepEqual(tools.map(t => t.name), ['web_search', 'web_fetch', 'submit_x'], 'only web tools + app tools pass');
const ws = tools[0];
assert.ok(Array.isArray(ws.allowed_domains) && ws.allowed_domains.includes('e-vrit.co.il'));
assert.equal(ws.user_location, undefined, 'user_location must not be sent (IL is rejected by the API)');
assert.ok(tools[1].allowed_domains.length > 0);
console.log('worker: ok');
