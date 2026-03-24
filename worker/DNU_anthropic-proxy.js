/**
 * Anthropic API Proxy — Cheeky Noodles Headcount
 * Deploy to: cheeky-headcount.vaughan-184.workers.dev
 *
 * Secrets (set via Cloudflare dashboard or wrangler):
 *   ANTHROPIC_API_KEY  — your Anthropic key from console.anthropic.com
 *
 * Allowed origins — only requests from your Pages domain are accepted.
 */

const ALLOWED_ORIGINS = [
  "https://cheekyfoods.app",
  "https://www.cheekyfoods.app",
];

// In dev you may want to add http://localhost:5173 etc — do not commit that to prod.

export default {
  async fetch(request, env) {

    const origin = request.headers.get("Origin") || "";

    // ── CORS preflight ──────────────────────────────────────────────
    if (request.method === "OPTIONS") {
      return corsResponse(null, 204, origin);
    }

    // ── Only POST /forecast is accepted ────────────────────────────
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/forecast") {
      return corsResponse(JSON.stringify({ error: "Not found" }), 404, origin);
    }

    // ── Origin check ────────────────────────────────────────────────
    if (!ALLOWED_ORIGINS.includes(origin)) {
      return corsResponse(JSON.stringify({ error: "Forbidden" }), 403, origin);
    }

    // ── Validate API key is configured ──────────────────────────────
    if (!env.ANTHROPIC_API_KEY) {
      return corsResponse(JSON.stringify({ error: "ANTHROPIC_API_KEY secret not set" }), 500, origin);
    }

    // ── Parse request body ──────────────────────────────────────────
    let body;
    try {
      body = await request.json();
    } catch {
      return corsResponse(JSON.stringify({ error: "Invalid JSON body" }), 400, origin);
    }

    // ── Forward to Anthropic ────────────────────────────────────────
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":            "application/json",
        "x-api-key":               env.ANTHROPIC_API_KEY,
        "anthropic-version":       "2023-06-01",
      },
      body: JSON.stringify({
        model:      body.model      || "claude-sonnet-4-20250514",
        max_tokens: body.max_tokens || 1000,
        messages:   body.messages,
        // system prompt can be passed through if present
        ...(body.system ? { system: body.system } : {}),
      }),
    });

    const anthropicBody = await anthropicRes.text();

    return corsResponse(anthropicBody, anthropicRes.status, origin, {
      "Content-Type": "application/json",
    });
  },
};

// ── Helper ──────────────────────────────────────────────────────────
function corsResponse(body, status, origin, extraHeaders = {}) {
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return new Response(body, {
    status,
    headers: {
      "Access-Control-Allow-Origin":  allowedOrigin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary":                         "Origin",
      ...extraHeaders,
    },
  });
}
