import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

type GlobalWithSupabase = typeof globalThis & {
    __supabaseBrowserClient?: SupabaseClient
}

const globalWithSupabase = globalThis as GlobalWithSupabase

export function getBrowserSupabaseClient(): SupabaseClient {
    if (!globalWithSupabase.__supabaseBrowserClient) {
        globalWithSupabase.__supabaseBrowserClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    }

    return globalWithSupabase.__supabaseBrowserClient
}
