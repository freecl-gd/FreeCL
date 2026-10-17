// npx --yes --package=deno deno run --allow-env supabase/user-management-check.ts
// Auth is mocked: no live account is banned. Account deletion was removed, so the
// checks also assert the server refuses it and never issues a DELETE.
import assert from 'node:assert/strict';
import { handle } from './functions/admin-users/index.ts';
import { banAttributes, canManage } from './functions/admin-users/rules.ts';
import { identityHash } from './functions/_shared/withdrawn.ts';

const actor = '11111111-1111-4111-8111-111111111111';
const target = '22222222-2222-4222-8222-222222222222';
Deno.env.set('SUPABASE_URL', 'https://test.invalid');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service-test');
assert.equal(canManage(actor, false, target, null), true);
assert.equal(canManage(actor, false, target, 1), false);
assert.equal(canManage(actor, true, target, 1), true);
assert.equal(canManage(actor, true, target, 0), false);
assert.equal(canManage(actor, true, actor, null), false);
assert.equal(banAttributes({ action: 'unban' }).ban_duration, 'none');
assert.equal(banAttributes({ action: 'ban', permanent: true }).app_metadata.banned_permanently, true);
// A term is whole calendar months from the server's clock: Oct 3 + 1 month is Nov 3 (31 days).
assert.equal(banAttributes({ action: 'ban', months: 1 }, Date.UTC(2026, 9, 3)).ban_duration, `${31 * 86400}s`);
assert.equal(banAttributes({ action: 'ban', months: 12 }, Date.UTC(2026, 9, 3)).ban_duration, `${365 * 86400}s`);
// Jan 31 + 1 month ends on Feb 28, not Mar 3.
assert.equal(banAttributes({ action: 'ban', months: 1 }, Date.UTC(2027, 0, 31)).ban_duration, `${28 * 86400}s`);
assert.equal(banAttributes({ action: 'ban', months: 3 }).app_metadata.banned_permanently, false);
for (const months of [0, -1, 1.5, '3', null, undefined, 1201]) assert.throws(() => banAttributes({ action: 'ban', months }), `months=${months}`);
// The old date form is gone: a request that still sends one is refused, not silently banned.
assert.throws(() => banAttributes({ action: 'ban', until: '2099-01-01T00:00:00Z' }));

let state: { signedIn: boolean; admin: boolean; root: boolean; role: number | null };
let calls: { method: string; path: string; body: Record<string, unknown>; query?: string }[];
function reset() { state = { signedIn: true, admin: true, root: false, role: null }; calls = []; }
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const path = new URL(request.url).pathname;
  const body = request.method === 'GET' ? {} : await request.json().catch(() => ({}));
  calls.push({ method: request.method, path, body });
  let result: unknown = [];
  let status = 200;
  if (path === '/auth/v1/user') {
    if (!state.signedIn) { result = { message: 'Invalid JWT', code: 'bad_jwt' }; status = 401; }
    else result = { id: actor, aud: 'authenticated' };
  } else if (path.endsWith('/rpc/is_admin')) result = state.admin;
  else if (path.endsWith('/rpc/is_root')) result = state.root;
  else if (path.endsWith('/admins')) result = state.role === null ? [] : [{ role_id: state.role }];
  else if (path.startsWith('/auth/v1/admin/users/')) result = { id: target, email: 'fixture@example.invalid' };
  else if (path === '/rest/v1/blocked_emails') { status = 201; result = null; }
  else throw new Error(`Unexpected request ${path}`);
  calls.at(-1)!.query = new URL(request.url).search;
  return new Response(result === null ? null : JSON.stringify(result), { status, headers: { 'Content-Type': 'application/json' } });
};
const invoke = (body: unknown) => handle(new Request('https://test.invalid/admin-users', { method: 'POST', headers: { Authorization: 'Bearer actor-token', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
const writes = () => calls.filter((call) => ['PUT', 'DELETE'].includes(call.method));
try {
  reset(); state.signedIn = false;
  assert.equal((await invoke({ action: 'ban', userId: target, permanent: true })).status, 401);
  assert.equal(writes().length, 0);
  reset(); state.admin = false;
  assert.equal((await invoke({ action: 'ban', userId: target, permanent: true })).status, 403);
  assert.equal(writes().length, 0);
  for (const role of [0, 1]) {
    reset(); state.role = role;
    assert.equal((await invoke({ action: 'ban', userId: target, permanent: true })).status, 403);
    assert.equal(writes().length, 0);
  }
  reset(); state.root = true;
  assert.equal((await invoke({ action: 'ban', userId: actor, permanent: true })).status, 403);
  reset();
  assert.equal((await invoke(null)).status, 400);
  assert.equal((await invoke({ action: 'ban', userId: target, months: 0 })).status, 400);
  assert.equal(writes().length, 0);
  reset();
  assert.equal((await invoke({ action: 'ban', userId: target, permanent: true })).status, 200);
  assert.equal(writes()[0].body.ban_duration, '876000h');
  assert.equal('until' in writes()[0].body, false, 'the list-only field never reaches Auth');
  const fixtureHash = await identityHash('fixture@example.invalid');
  const listed = () => calls.filter((call) => call.path === '/rest/v1/blocked_emails');
  assert.deepEqual(listed()[0].body, { email_hash: fixtureHash, reason: 'ban', banned_until: null }, 'a permanent ban blocks the email with no end');
  reset();
  assert.equal((await invoke({ action: 'unban', userId: target })).status, 200);
  assert.equal(writes()[0].body.ban_duration, 'none');
  assert.equal(listed()[0].method, 'DELETE');
  assert.ok(listed()[0].query?.includes(`email_hash=eq.${fixtureHash}`) && listed()[0].query?.includes('reason=eq.ban'), 'unban lifts only the ban row, never a withdrawal'); 
  reset();
  assert.equal((await invoke({ action: 'ban', userId: target, months: 3 })).status, 200);
  const banned = Number(String(writes()[0].body.ban_duration).replace(/s$/, ''));
  assert.ok(banned >= 89 * 86400 && banned <= 92 * 86400, `3 months came out as ${banned}s`);
  const ends = Date.parse(String(listed()[0].body.banned_until));
  assert.ok(Math.abs(ends - (Date.now() + banned * 1000)) < 5000, 'the email block ends with the Auth ban');
  // Deletion is gone: the action is refused outright and nothing is ever deleted.
  reset();
  assert.equal((await invoke({ action: 'delete', userId: target, confirmation: 'fixture' })).status, 400);
  assert.equal(writes().length, 0);
  assert.equal(calls.some((call) => call.method === 'DELETE'), false);
  console.log('User management: permissions, timed/permanent bans, unban and the removal of account deletion passed.');
} finally { globalThis.fetch = originalFetch; }
