import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('Missing Supabase env vars — check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env')
}

// Create a base client — token is injected per-request via getSupabaseClient()
const _base = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// Call this with the current Clerk session token before any DB operation.
// Returns a Supabase client that sends the JWT in the Authorization header.
// Supabase validates this against Clerk's public key — anon key alone is not enough.
export function getSupabaseClient(clerkToken) {
  if (!clerkToken) return _base
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { Authorization: `Bearer ${clerkToken}` },
    },
  })
}
