// npx --yes --package=deno deno run --allow-env supabase/withdraw-check.ts
// Auth, PostgREST and Storage are mocked: no live account is touched.
import assert from 'node:assert/strict';
import { handle } from './functions/withdraw/index.ts';
import { identityHash } from './functions/_shared/withdrawn.ts';

// Same digest as public.identity_hash(): sha256 of the trimmed, lowercased value.
assert.equal(await identityHash('  Mixed@Example.COM '), 'f08ee104acdda5efd90a39c81ce3be9ffaa02265d9fffa388e5353d93da47ff8');

const me = '33333333-3333-4333-8333-333333333333';
Deno.env.set('SUPABASE_URL', 'https://test.invalid');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service-test');
let state: { active: boolean; role: number | null; deleteFails: boolean; files: string[] };
let calls: { method: string; path: string; body: unknown }[];
function reset() { state = { active: true, role: null, deleteFails: false, files: [] }; calls = []; }
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  const body = request.method === 'GET' ? null : await request.json().catch(() => null);
  calls.push({ method: request.method, path: url.pathname, body });
  let result: unknown = [];
  let status = 200;
  if (url.pathname === '/auth/v1/user') result = { id: me, aud: 'authenticated', email: 'Mixed@Example.com' };
  else if (url.pathname.endsWith('/rpc/is_active_account')) result = state.active;
  else if (url.pathname.endsWith('/profiles')) result = { username: 'mixed' };
  else if (url.pathname.endsWith('/admins')) result = state.role === null ? null : { role_id: state.role };
  else if (url.pathname.endsWith('/blocked_emails')) { status = request.method === 'POST' ? 201 : 204; result = null; }
  else if (url.pathname === `/storage/v1/object/list/avatars`) result = state.files.map((name) => ({ name }));
  else if (url.pathname === '/storage/v1/object/avatars') result = [];
  else if (url.pathname.endsWith('/rpc/purge_account')) { if (state.deleteFails) { status = 500; result = { message: 'boom' }; } else result = { records: 1, legacy: 0 }; }
  else throw new Error(`Unexpected request ${request.method} ${url.pathname}`);
  return new Response(result === null ? null : JSON.stringify(result), { status, headers: { 'Content-Type': 'application/json' } });
};
const invoke = (body: unknown) => handle(new Request('https://test.invalid/withdraw', { method: 'POST', headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
const writes = () => calls.filter((call) => call.method !== 'GET' && !call.path.endsWith('/rpc/is_active_account') && !call.path.includes('/object/list/'));

reset(); state.active = false;
assert.equal((await invoke({ username: 'mixed' })).status, 403, 'a banned account cannot withdraw');
assert.equal(writes().length, 0);
for (const role of [0, 1]) {
  reset(); state.role = role;
  assert.equal((await invoke({ username: 'mixed' })).status, 403, `admin role ${role} cannot withdraw`);
  assert.equal(writes().length, 0);
}
reset();
assert.equal((await invoke({ username: 'someone' })).status, 400, 'nickname must match');
assert.equal(writes().length, 0);

reset(); state.files = ['a.png'];
assert.equal((await invoke({ username: ' Mixed ' })).status, 200);
const [insert, removeFiles, remove] = writes();
assert.equal(insert.path, '/rest/v1/blocked_emails');
const { banned_until: waitsUntil, ...row } = insert.body as Record<string, unknown>;
assert.deepEqual(row, { email_hash: await identityHash('mixed@example.com'), username_hash: await identityHash('mixed'), reason: 'withdrawn' });
assert.ok(Math.abs(Date.parse(String(waitsUntil)) - (Date.now() + 30 * 86400000)) < 5000, 'a withdrawn email waits 30 days, it is not banned');
assert.equal(removeFiles.method, 'DELETE');
assert.deepEqual(removeFiles.body, { prefixes: [`${me}/a.png`] });
assert.deepEqual([remove.path, remove.body], ['/rest/v1/rpc/purge_account', { p_user_id: me }], 'block is recorded before the account and its clears go');

reset(); state.deleteFails = true;
assert.equal((await invoke({ username: 'mixed' })).status, 500);
const undo = writes().at(-1)!;
assert.deepEqual([undo.method, undo.path], ['DELETE', '/rest/v1/blocked_emails'], 'a failed deletion lifts the block');
console.log('withdraw check 통과');
