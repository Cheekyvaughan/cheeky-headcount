import { getSupabaseClient } from './supabaseClient.js'

let _getToken = null

export function initStorage(getToken) {
  _getToken = getToken
  console.log('[storage] Supabase storage initialised')

  window.storage = {
    get: async (key) => {
      try {
        const token = await _getToken({ template: 'supabase' })
        if (!token) { console.error('[storage] getToken null for get:', key); return null }
        const db = getSupabaseClient(token)
        const { data, error } = await db
          .from('app_storage')
          .select('value, updated_at')
          .eq('key', key)
          .maybeSingle()
        if (error) { console.error('[storage] get error:', key, error.message, error.code); return null }
        console.log('[storage] get:', key, data ? 'found' : 'not found')
        return data ? { key, value: data.value, updated_at: data.updated_at } : null
      } catch (e) {
        console.error('[storage] get exception:', key, e)
        return null
      }
    },

    set: async (key, value) => {
      try {
        const token = await _getToken({ template: 'supabase' })
        if (!token) { console.error('[storage] getToken null for set:', key); return null }
        const db = getSupabaseClient(token)
        const newTs = new Date().toISOString()
        const { error } = await db
          .from('app_storage')
          .upsert({ key, value, updated_at: newTs }, { onConflict: 'key' })
        if (error) { console.error('[storage] set error:', key, error.message, error.code); return null }
        console.log('[storage] set:', key)
        return { key, value, updated_at: newTs }
      } catch (e) {
        console.error('[storage] set exception:', key, e)
        return null
      }
    },

    checkAndSet: async (key, value, expectedUpdatedAt) => {
      try {
        const token = await _getToken({ template: 'supabase' })
        if (!token) { console.error('[storage] getToken null for checkAndSet:', key); return null }
        const db = getSupabaseClient(token)
        if (expectedUpdatedAt) {
          const { data: current, error: checkErr } = await db
            .from('app_storage')
            .select('updated_at')
            .eq('key', key)
            .maybeSingle()
          if (checkErr) { console.error('[storage] checkAndSet conflict-check error:', key, checkErr.message); return null }
          if (current && current.updated_at !== expectedUpdatedAt) {
            console.warn('[storage] conflict detected for key:', key)
            return { conflict: true, dbUpdatedAt: current.updated_at }
          }
        }
        const newTs = new Date().toISOString()
        const { error } = await db
          .from('app_storage')
          .upsert({ key, value, updated_at: newTs }, { onConflict: 'key' })
        if (error) { console.error('[storage] checkAndSet write error:', key, error.message); return null }
        console.log('[storage] checkAndSet: saved', key)
        return { ok: true, updated_at: newTs }
      } catch (e) {
        console.error('[storage] checkAndSet exception:', key, e)
        return null
      }
    },

    delete: async (key) => {
      try {
        const token = await _getToken({ template: 'supabase' })
        if (!token) { console.error('[storage] getToken null for delete:', key); return null }
        const db = getSupabaseClient(token)
        const { error } = await db.from('app_storage').delete().eq('key', key)
        if (error) { console.error('[storage] delete error:', key, error.message); return null }
        return { key, deleted: true }
      } catch (e) {
        console.error('[storage] delete exception:', key, e)
        return null
      }
    },

    list: async (prefix) => {
      try {
        const token = await _getToken({ template: 'supabase' })
        if (!token) { console.error('[storage] getToken null for list'); return null }
        const db = getSupabaseClient(token)
        let query = db.from('app_storage').select('key')
        if (prefix) query = query.like('key', `${prefix}%`)
        const { data, error } = await query
        if (error) { console.error('[storage] list error:', error.message); return null }
        return { keys: (data || []).map(r => r.key), prefix }
      } catch (e) {
        console.error('[storage] list exception:', e)
        return null
      }
    },
  }
}