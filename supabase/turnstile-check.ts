// Mocks Cloudflare; no network. Run: npx --yes --package=deno deno run --allow-env supabase/turnstile-check.ts
import assert from "node:assert/strict";
import { captchaPassed, clientIp } from "./functions/_shared/turnstile.ts";

const sent: FormData[] = [];
let answer = { success: true };
globalThis.fetch = (async (_url: string, init: RequestInit) => { sent.push(init.body as FormData); return new Response(JSON.stringify(answer)); }) as typeof fetch;

Deno.env.delete("TURNSTILE_SECRET_KEY");
assert.equal(await captchaPassed("t", "1.2.3.4"), "misconfigured", "unset secret fails closed");
Deno.env.set("TURNSTILE_SECRET_KEY", "s");
assert.equal(await captchaPassed("", null), false);
assert.equal(await captchaPassed(undefined, null), false);
assert.equal(sent.length, 0, "no call without a secret or token");
assert.equal(await captchaPassed("t", "1.2.3.4"), true);
assert.equal(sent[0].get("remoteip"), "1.2.3.4");
answer = { success: false };
assert.equal(await captchaPassed("t", null), false);
assert.equal(sent[1].get("remoteip"), null);
answer = { success: false, "error-codes": ["invalid-input-secret"] } as never;
assert.equal(await captchaPassed("t", null), "misconfigured", "a rejected secret is a server fault");
answer = { success: false, "error-codes": ["invalid-input-response"] } as never;
assert.equal(await captchaPassed("t", null), false);

assert.equal(clientIp(new Request("http://x", { headers: { "CF-Connecting-IP": "9.9.9.9", "x-forwarded-for": "1.1.1.1" } })), "9.9.9.9");
assert.equal(clientIp(new Request("http://x", { headers: { "x-forwarded-for": "1.1.1.1, 2.2.2.2" } })), "1.1.1.1");
assert.equal(clientIp(new Request("http://x")), null);
console.log("turnstile check 통과");
