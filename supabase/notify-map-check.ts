// npx --yes --package=deno deno run --allow-env supabase/notify-map-check.ts
// Discord is mocked: no message is ever posted to a real channel.
import assert from 'node:assert/strict';
import { handle } from './functions/notify-map/index.ts';

const hook = 'https://discord.invalid/api/webhooks/test';
const map = { level_id: '146308126', type: 'classic', name: '테스트 맵', creator: 'xisik', verifier: 'krim57', length: '23s', position: 3, description: '설명' };
const post = (record: unknown, secret = 'topsecret') =>
  handle(new Request('https://fn.invalid/', { method: 'POST', headers: { 'x-notify-secret': secret }, body: JSON.stringify({ record }) }));

let posted: { url: string; body: Record<string, any> }[] = [];
let ok = true;
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  posted.push({ url: String(url), body: JSON.parse(String(init?.body)) });
  return new Response(ok ? null : 'rate limited', { status: ok ? 204 : 429 });
}) as typeof fetch;

// Unconfigured refuses rather than posting anywhere.
assert.equal((await post(map)).status, 503);
Deno.env.set('NOTIFY_SECRET', 'topsecret');
Deno.env.set('DISCORD_WEBHOOK_URL', hook);
assert.equal(posted.length, 0);

assert.equal((await post(map, 'guess')).status, 403);
assert.equal((await handle(new Request('https://fn.invalid/', { method: 'GET' }))).status, 405);
assert.equal((await post({ type: 'classic' })).status, 400);
assert.equal(posted.length, 0, '거부된 요청은 Discord를 호출하지 않는다');

assert.equal((await post(map)).status, 200);
assert.equal(posted.length, 1);
assert.equal(posted[0].url, hook);
const [sent] = posted;
assert.equal(sent.body.content, '새 맵 등재 — TIMED #3');
assert.equal(sent.body.embeds[0].title, '테스트 맵');
assert.equal(sent.body.embeds[0].url, 'https://freecl.web.app/classic/challenge/?levelId=146308126');
assert.deepEqual(sent.body.embeds[0].fields.map((f: { name: string; value: string }) => [f.name, f.value]),
  [['분류', 'TIMED'], ['순위', '#3'], ['제작자', 'xisik'], ['길이', '23s'], ['베리파이어', 'krim57']]);

// EXTRA and PLAT reach the same alarm with the site's own names, and a platformer has no length.
posted = [];
await post({ ...map, type: 'extra', position: 1 });
await post({ ...map, type: 'platformer', length: '', verifier: '', creator: '', position: 4 });
assert.equal(posted[0].body.content, '새 맵 등재 — EXTRA #1');
assert.equal(posted[1].body.content, '새 맵 등재 — PLAT #4');
assert.deepEqual(posted[1].body.embeds[0].fields.map((f: { value: string }) => f.value), ['PLAT', '#4', '미등록']);

// A long admin description is cut, not rejected by Discord.
posted = [];
await post({ ...map, description: 'ㄱ'.repeat(900) });
assert.equal(posted[0].body.embeds[0].description.length, 500);

// Discord failing must not read as a failed registration.
ok = false;
assert.equal((await post(map)).status, 200);

console.log('notify-map check 통과');
