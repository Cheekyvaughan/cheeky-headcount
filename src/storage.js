import { getSupabaseClient } from './supabaseClient.js'

let _getToken = null

export function initStorage(getToken) {
  _getToken = getToken
  console.log('[storage] Supabase storage initialised')

  window.storage = {
    get: async (key) => {
      try {
        const token = await _getToken({ template: 'supabase' })
        if (!token) { console.error('[storage] getToken returned null for key:', key); return null }
        const db = getSupabaseClient(token)
        const { data, error } = await db
          .from('app_storage')
          .select('value')
          .eq('key', key)
          .maybeSingle()
        if (error) { console.error('[storage] get error:', key, error.message, error.code); return null }
        console.log('[storage] get:', key, data ? 'found' : 'not found')
        return data ? { key, value: data.value } : null
      } catch (e) {
        console.error('[storage] get exception:', key, e)
        return null
      }
    },

    set: async (key, value) => {
      try {
        const token = await _getToken({ template: 'supabase' })
        if (!token) { console.error('[storage] getToken returned null for set:', key); return null }
        const db = getSupabaseClient(token)
        const { error } = await db
          .from('app_storage')
          .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
        if (error) { console.error('[storage] set error:', key, error.message, error.code); return null }
        console.log('[storage] set:', key)
        return { key, value }
      } catch (e) {
        console.error('[storage] set exception:', key, e)
        return null
      }
    },

    delete: async (key) => {
      try {
        const token = await _getToken({ template: 'supabase' })
        if (!token) { console.error('[storage] getToken returned null for delete:', key); return null }
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
        if (!token) { console.error('[storage] getToken returned null for list'); return null }
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