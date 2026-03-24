// Storage layer — backed by Cloudflare D1 via the Worker.
// Drop-in replacement for the previous Supabase-backed version.
// window.storage API is identical; callers require no changes.

const WORKER_URL = 'https://cheeky-headcount-proxy.vaughan-184.workers.dev'

let _getToken = null

export function initStorage(getToken) {
  _getToken = getToken

  window.storage = {

    get: async (key) => {
      try {
        const token = await _getToken()
        if (!token) return null
        const res = await fetch(`${WORKER_URL}/storage/get`, post(token, { key }))
        if (!res.ok) { logErr('get', key, res.status); return null }
        return await res.json()  // { key, value, updated_at } | null
      } catch (e) { logEx('get', key, e); return null }
    },

    set: async (key, value) => {
      try {
        const token = await _getToken()
        if (!token) return null
        const res = await fetch(`${WORKER_URL}/storage/set`, post(token, { key, value }))
        if (!res.ok) { logErr('set', key, res.status); return null }
        return await res.json()  // { key, value, updated_at }
      } catch (e) { logEx('set', key, e); return null }
    },

    checkAndSet: async (key, value, expectedUpdatedAt) => {
      try {
        const token = await _getToken()
        if (!token) return null
        const res = await fetch(`${WORKER_URL}/storage/check-and-set`,
          post(token, { key, value, expectedUpdatedAt }))
        if (!res.ok) { logErr('checkAndSet', key, res.status); return null }
        return await res.json()  // { ok, updated_at } | { conflict, dbUpdatedAt }
      } catch (e) { logEx('checkAndSet', key, e); return null }
    },

    delete: async (key) => {
      try {
        const token = await _getToken()
        if (!token) return null
        const res = await fetch(`${WORKER_URL}/storage/delete`, post(token, { key }))
        if (!res.ok) { logErr('delete', key, res.status); return null }
        return await res.json()  // { key, deleted: true }
      } catch (e) { logEx('delete', key, e); return null }
    },

    list: async (prefix) => {
      try {
        const token = await _getToken()
        if (!token) return null
        const res = await fetch(`${WORKER_URL}/storage/list`, post(token, { prefix }))
        if (!res.ok) { logErr('list', prefix, res.status); return null }
        return await res.json()  // { keys, prefix }
      } catch (e) { logEx('list', prefix, e); return null }
    },
  }
}

// ── Helpers ───────────────────────────────────────────────────────────
function post(token, body) {
  return {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  }
}

function logErr(op, key, status) {
  if (import.meta.env.DEV) console.error(`[storage] ${op} HTTP ${status}:`, key)
}

function logEx(op, key, err) {
  if (import.meta.env.DEV) console.error(`[storage] ${op} exception:`, key, err)
}