import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('Missing Supabase env vars — check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env')
}

// Single cached client — re-created only when the token changes.
// This prevents the "multiple GoTrueClient instances" warning that fires when
// createClient() is called on every storage operation.
let _cachedToken = null
let _cachedClient = null

export function getSupabaseClient(clerkToken) {
  if (!clerkToken) {
    // Unauthenticated base client (should not reach DB due to RLS)
    if (!_cachedClient) {
      _cachedClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    }
    return _cachedClient
  }

  if (clerkToken !== _cachedToken) {
    _cachedToken = clerkToken
    _cachedClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        headers: { Authorization: `Bearer ${clerkToken}` },
      },
    })
  }

  return _cachedClient
}