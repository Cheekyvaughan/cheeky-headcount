/**
 * Cheeky Noodles Headcount — Cloudflare Worker
 *
 * Routes:
 *   POST /forecast               — Anthropic API proxy
 *   POST /storage/get            — D1 key lookup
 *   POST /storage/set            — D1 upsert
 *   POST /storage/check-and-set  — D1 conditional upsert (conflict detection)
 *   POST /storage/delete         — D1 delete
 *   POST /storage/list           — D1 prefix scan
 *
 * All routes require a valid Clerk JWT in the Authorization header.
 *
 * Secrets (set in Cloudflare dashboard → Worker → Settings → Variables):
 *   ANTHROPIC_API_KEY
 *
 * Bindings (set in Cloudflare dashboard → Worker → Settings → Integrations):
 *   DB  — D1 database (cheeky-headcount-storage)
 */

const ALLOWED_ORIGINS = [
  'https://headcountplan.cheekyfoods.app',
  'https://cheekyfoods.app',
  // 'http://localhost:5173',  // ← uncomment for local dev, never commit to prod
]

// ── Clerk JWT verification ────────────────────────────────────────────
// JWKS is cached at module level for the lifetime of the CF isolate.
// It is re-fetched at most once per hour.
let _jwksCache = null
let _jwksCacheTime = 0
const JWKS_TTL_MS = 60 * 60 * 1000

async function getClerkUserId(authHeader) {
  const token = (authHeader || '').replace(/^Bearer\s+/i, '').trim()
  if (!token) throw new Error('No authorization token')

  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('Malformed JWT')

  // base64url → base64 → JSON
  const b64 = s => s.replace(/-/g, '+').replace(/_/g, '/')
  const decodeJson = s => JSON.parse(atob(b64(s)))

  const header  = decodeJson(parts[0])
  const payload = decodeJson(parts[1])
  const EXPECTED_ISSUER = 'https://clerk.cheekyfoods.app'

  if (!payload.exp || payload.exp * 1000 < Date.now()) throw new Error('Token expired')
  if (!payload.iss) throw new Error('Missing iss claim')
  if (!payload.sub) throw new Error('Missing sub claim')
  if (payload.iss !== EXPECTED_ISSUER) throw new Error('Invalid issuer')

  // Hardcoded to prevent JWKS URL spoofing via a forged iss claim
  const jwksUrl = 'https://clerk.cheekyfoods.app/.well-known/jwks.json'

  const now = Date.now()
  if (!_jwksCache || now - _jwksCacheTime > JWKS_TTL_MS) {
    const res = await fetch(jwksUrl)
    if (!res.ok) throw new Error(`JWKS fetch failed (${res.status})`)
    _jwksCache = await res.json()
    _jwksCacheTime = now
  }

  const jwk = _jwksCache.keys?.find(k => k.kid === header.kid)
  if (!jwk) throw new Error(`No JWK for kid "${header.kid}"`)

  const cryptoKey = await crypto.subtle.importKey(
    'jwk', jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['verify']
  )

  const signingInput = new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  const sigBytes = Uint8Array.from(atob(b64(parts[2])), c => c.charCodeAt(0))

  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', cryptoKey, sigBytes, signingInput
  )
  if (!valid) throw new Error('JWT signature invalid')

  return payload.sub  // Clerk user ID
}

// ── Response helpers ──────────────────────────────────────────────────
function corsHeaders(origin, extra = {}) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
    ...extra,
  }
}

function jsonRes(body, status = 200, origin = '') {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders(origin, { 'Content-Type': 'application/json' }),
  })
}

// ── D1 upsert helper (same SQL used by set and check-and-set) ─────────
async function d1Upsert(db, key, value, updated_at) {
  await db
    .prepare(`
      INSERT INTO app_storage (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `)
    .bind(key, value, updated_at)
    .run()
}

// ── Main handler ──────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || ''

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) })
    }

    if (request.method !== 'POST') {
      return jsonRes({ error: 'Method not allowed' }, 405, origin)
    }

    const { pathname } = new URL(request.url)

    // Origin gate
    if (!ALLOWED_ORIGINS.includes(origin)) {
      return jsonRes({ error: 'Forbidden' }, 403, origin)
    }

    // Input size gate — prevent oversized payloads draining API credits
    const contentLength = parseInt(request.headers.get('Content-Length') || '0', 10)
    if (contentLength > 100_000) {
      return jsonRes({ error: 'Request too large' }, 413, origin)
    }

    // Auth gate — verify Clerk JWT on every route
    let _userId
    try {
      _userId = await getClerkUserId(request.headers.get('Authorization'))
    } catch (err) {
      return jsonRes({ error: `Unauthorized: ${err.message}` }, 401, origin)
    }

    // Parse body
    let body
    try {
      body = await request.json()
    } catch {
      return jsonRes({ error: 'Invalid JSON body' }, 400, origin)
    }

    // ── /forecast ─────────────────────────────────────────────────────
    if (pathname === '/forecast') {
      if (!env.ANTHROPIC_API_KEY) {
        return jsonRes({ error: 'ANTHROPIC_API_KEY not configured' }, 500, origin)
      }
      const upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model:      body.model      || 'claude-sonnet-4-6',
          max_tokens: body.max_tokens || 1000,
          messages:   body.messages,
          ...(body.system ? { system: body.system } : {}),
        }),
      })
      const text = await upstream.text()
      return new Response(text, {
        status: upstream.status,
        headers: corsHeaders(origin, { 'Content-Type': 'application/json' }),
      })
    }

    // ── Storage routes — require D1 binding ───────────────────────────
    if (!env.DB) {
      return jsonRes({ error: 'D1 database not bound — check Worker settings' }, 500, origin)
    }

    // GET
    if (pathname === '/storage/get') {
      const { key } = body
      if (!key) return jsonRes({ error: 'key required' }, 400, origin)

      const row = await env.DB
        .prepare('SELECT value, updated_at FROM app_storage WHERE key = ?')
        .bind(key)
        .first()

      return jsonRes(row ? { key, value: row.value, updated_at: row.updated_at } : null, 200, origin)
    }

    // SET
    if (pathname === '/storage/set') {
      const { key, value } = body
      if (!key || value === undefined) return jsonRes({ error: 'key and value required' }, 400, origin)

      const updated_at = new Date().toISOString()
      await d1Upsert(env.DB, key, value, updated_at)
      return jsonRes({ key, value, updated_at }, 200, origin)
    }

    // CHECK-AND-SET (optimistic concurrency)
    if (pathname === '/storage/check-and-set') {
      const { key, value, expectedUpdatedAt } = body
      if (!key || value === undefined) return jsonRes({ error: 'key and value required' }, 400, origin)

      if (expectedUpdatedAt) {
        const current = await env.DB
          .prepare('SELECT updated_at FROM app_storage WHERE key = ?')
          .bind(key)
          .first()

        if (current && current.updated_at !== expectedUpdatedAt) {
          return jsonRes({ conflict: true, dbUpdatedAt: current.updated_at }, 200, origin)
        }
      }

      const updated_at = new Date().toISOString()
      await d1Upsert(env.DB, key, value, updated_at)
      return jsonRes({ ok: true, updated_at }, 200, origin)
    }

    // DELETE
    if (pathname === '/storage/delete') {
      const { key } = body
      if (!key) return jsonRes({ error: 'key required' }, 400, origin)

      await env.DB
        .prepare('DELETE FROM app_storage WHERE key = ?')
        .bind(key)
        .run()

      return jsonRes({ key, deleted: true }, 200, origin)
    }

    // LIST (prefix scan)
    if (pathname === '/storage/list') {
      const { prefix } = body

      const result = prefix
        ? await env.DB
            .prepare('SELECT key FROM app_storage WHERE key LIKE ?')
            .bind(`${prefix}%`)
            .all()
        : await env.DB
            .prepare('SELECT key FROM app_storage')
            .all()

      const keys = (result.results || []).map(r => r.key)
      return jsonRes({ keys, prefix: prefix || null }, 200, origin)
    }

    return jsonRes({ error: 'Not found' }, 404, origin)
  },
}
