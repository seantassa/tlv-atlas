// Live Plan · AI proxy (Cloudflare Worker)
// Keeps the Anthropic API key on the server and caps usage per visitor and per day.
//
// Setup (Cloudflare dashboard → Workers & Pages → Create Worker → paste this file):
//   Settings → Variables and Secrets → add Secret  ANTHROPIC_API_KEY  = your key
//   Settings → Bindings → add KV namespace binding  QUOTA  (create a namespace called live-plan-quota)
//   Optional plain variable ALLOWED_ORIGIN = https://seantassa.github.io
//   Leads: add Secret ADMIN_TOKEN (any long random word). See your leads at  <worker-url>/leads?token=ADMIN_TOKEN

const MODELS = { plan: "claude-sonnet-5-5", design: "claude-sonnet-5-5", ask: "claude-haiku-5-5" };
const MAX_TOKENS = { plan: 8000, design: 6000, ask: 700 };
const PER_VISITOR_PER_DAY = { plan: 3, design: 6, ask: 25 };
const ALL_VISITORS_PER_DAY = 250; // hard daily ceiling for the whole site

export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "";
    const allowed = env.ALLOWED_ORIGIN || "https://seantassa.github.io";
    const cors = {
      "Access-Control-Allow-Origin": origin === allowed ? origin : allowed,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
    };
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    const url = new URL(req.url);
    // ---- leads: list (private) ----
    if (req.method === "GET" && url.pathname === "/leads") {
      if (!env.ADMIN_TOKEN || url.searchParams.get("token") !== env.ADMIN_TOKEN) return new Response("forbidden", { status: 403 });
      const list = await env.QUOTA.list({ prefix: "lead:" });
      const rows = await Promise.all(list.keys.map((k) => env.QUOTA.get(k.name)));
      const leads = rows.filter(Boolean).map((r) => JSON.parse(r)).sort((a, b) => b.at.localeCompare(a.at));
      const esc = (v) => String(v ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
      const html = `<!doctype html><meta charset="utf-8"><title>Leads</title><body dir="rtl" style="font-family:system-ui;padding:20px"><h1>לידים · ${leads.length}</h1><table border="1" cellpadding="6" style="border-collapse:collapse">
<tr><th>תאריך</th><th>שם</th><th>טלפון</th><th>מייל</th><th>שירות</th><th>הערה</th><th>הדירה</th></tr>${leads.map((l) => `<tr><td>${esc(l.at.slice(0, 16).replace("T", " "))}</td><td>${esc(l.name)}</td><td>${esc(l.phone)}</td><td>${esc(l.email)}</td><td>${esc(l.service)}</td><td>${esc(l.note)}</td><td>${esc(l.plan)}</td></tr>`).join("")}</table>`;
      return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    if (req.method !== "POST") return json({ error: "method" }, 405);
    if (origin && origin !== allowed) return json({ error: "origin" }, 403);

    let body;
    try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
    // ---- leads: save ----
    if (url.pathname === "/lead") {
      const clip = (v, n) => String(v ?? "").slice(0, n);
      const lead = { at: new Date().toISOString(), name: clip(body.name, 80), phone: clip(body.phone, 30), email: clip(body.email, 120), service: clip(body.service, 80), note: clip(body.note, 600), plan: clip(body.plan, 300) };
      if (!lead.name || !(lead.phone || lead.email)) return json({ error: "missing" }, 400);
      const ip = req.headers.get("CF-Connecting-IP") || "anon", day = new Date().toISOString().slice(0, 10);
      const k = `${day}:${ip}:lead`, n = +(await env.QUOTA.get(k)) || 0;
      if (n >= 5) return json({ error: "visitor_cap" }, 429);
      await env.QUOTA.put(k, String(n + 1), { expirationTtl: 172800 });
      await env.QUOTA.put(`lead:${lead.at}:${Math.random().toString(36).slice(2, 7)}`, JSON.stringify(lead));
      return json({ ok: true });
    }
    const kind = ["plan", "design", "ask"].includes(body.kind) ? body.kind : null;
    if (!kind) return json({ error: "kind" }, 400);

    // input checks
    const turns = Array.isArray(body.messages) ? body.messages : [{ role: "user", content: String(body.prompt || "") }];
    const textSize = turns.reduce((n, t) => n + String(t.content || "").length, 0);
    if (!textSize || textSize > 60000 || turns.length > 14) return json({ error: "too_large" }, 413);
    if (body.image && (typeof body.image.data !== "string" || body.image.data.length > 5_000_000)) return json({ error: "image_too_large" }, 413);

    // quota
    const day = new Date().toISOString().slice(0, 10);
    const ip = req.headers.get("CF-Connecting-IP") || "anon";
    if (env.QUOTA) {
      const kAll = `${day}:all`, kMe = `${day}:${ip}:${kind}`;
      const [all, me] = await Promise.all([env.QUOTA.get(kAll), env.QUOTA.get(kMe)]);
      if ((+all || 0) >= ALL_VISITORS_PER_DAY) return json({ error: "daily_cap" }, 429);
      if ((+me || 0) >= PER_VISITOR_PER_DAY[kind]) return json({ error: "visitor_cap" }, 429);
      await Promise.all([
        env.QUOTA.put(kAll, String((+all || 0) + 1), { expirationTtl: 172800 }),
        env.QUOTA.put(kMe, String((+me || 0) + 1), { expirationTtl: 172800 }),
      ]);
    }

    // build the request: the image goes with the last user turn
    const messages = turns.map((t) => ({ role: t.role === "assistant" ? "assistant" : "user", content: String(t.content) }));
    if (body.image && kind === "plan") {
      const last = messages[messages.length - 1];
      last.content = [
        { type: "image", source: { type: "base64", media_type: body.image.media_type || "image/jpeg", data: body.image.data } },
        { type: "text", text: last.content },
      ];
    }
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODELS[kind], max_tokens: MAX_TOKENS[kind], messages }),
    });
    if (!r.ok) {
      const errText = await r.text();
      if (/credit balance/i.test(errText)) return json({ error: "out_of_credit" }, 429);
      const status = r.status === 429 || r.status === 529 ? 429 : 502;
      return json({ error: r.status === 400 ? "bad_request" : "upstream", status: r.status }, status);
    }
    const data = await r.json();
    const text = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
    return json({ text, truncated: data.stop_reason === "max_tokens" });
  },
};
