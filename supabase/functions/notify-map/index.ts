// A Supabase Database Webhook on insert into maps / extra_maps calls this. That insert is
// where every registration path ends — the admin form, approve_submission, and EXTRA — so
// the alarm is attached once, there, instead of at each caller.
import { typeName } from "../_shared/lists.js";

export async function handle(request: Request) {
  if (request.method !== "POST") return new Response("POST only", { status: 405 });
  const secret = Deno.env.get("NOTIFY_SECRET");
  const target = Deno.env.get("DISCORD_WEBHOOK_URL");
  // Fails closed when unconfigured, like submit's Turnstile check.
  if (!secret || !target) return new Response("not configured", { status: 503 });
  if (request.headers.get("x-notify-secret") !== secret) return new Response("forbidden", { status: 403 });

  const { record } = await request.json().catch(() => ({}));
  if (!record?.level_id || !record?.type) return new Response("no record", { status: 400 });

  const list = typeName(record.type);
  const fields = [
    { name: "분류", value: list, inline: true },
    { name: "순위", value: `#${record.position}`, inline: true },
    { name: "제작자", value: record.creator || "미등록", inline: true },
  ];
  if (record.length) fields.push({ name: "길이", value: record.length, inline: true });
  if (record.verifier) fields.push({ name: "베리파이어", value: record.verifier, inline: true });

  const sent = await fetch(target, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // The content line is what a phone's push preview shows; an embed alone previews blank.
    body: JSON.stringify({
      content: `새 맵 등재 — ${list} #${record.position}`,
      embeds: [{
        title: record.name,
        url: `https://freecl.web.app/${record.type}/challenge/?levelId=${encodeURIComponent(record.level_id)}`,
        // The admin form has no 120-character cap, and Discord rejects a long description.
        description: record.description ? String(record.description).slice(0, 500) : undefined,
        color: 0x5865f2,
        fields,
      }],
    }),
  });
  // The map is already committed — the webhook fires after the transaction — so a Discord
  // outage must never read as a failed registration. Log it and answer ok.
  if (!sent.ok) console.error("Discord webhook failed", sent.status, await sent.text().catch(() => ""));
  return new Response("ok");
}

if (import.meta.main) Deno.serve(handle);
