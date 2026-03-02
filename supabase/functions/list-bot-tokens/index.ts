import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verifyPrivyToken } from '../_shared/crypto.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-privy-token',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  
  try {
    console.log('[LIST-BOT-TOKENS] Request received');
    
    // Verify Privy token
    const privyToken = req.headers.get('X-Privy-Token');
    console.log('[LIST-BOT-TOKENS] Privy token present:', !!privyToken, 'length:', privyToken?.length);
    
    if (!privyToken) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing Privy token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    let privyUser;
    try {
      privyUser = await verifyPrivyToken(privyToken);
    } catch (verifyError) {
      console.error('[LIST-BOT-TOKENS] Privy verification error:', verifyError);
      return new Response(
        JSON.stringify({ success: false, error: 'Token verification failed' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    if (!privyUser || !privyUser.id) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid Privy token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log('[LIST-BOT-TOKENS] User verified:', privyUser.id);
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    
    // Fetch tokens for this user
    console.log('[LIST-BOT-TOKENS] Fetching tokens for user:', privyUser.id);
    
    const { data: tokens, error } = await supabase
      .from('bot_tokens')
      .select('id, label, permissions, created_at, expires_at, last_used_at, is_revoked')
      .eq('user_id', privyUser.id)
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('[LIST-BOT-TOKENS] Supabase error:', error);
      throw new Error('Failed to fetch tokens');
    }
    
    console.log('[LIST-BOT-TOKENS] Found tokens:', tokens?.length || 0);
    
    return new Response(
      JSON.stringify({
        success: true,
        data: { tokens: tokens || [] }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('[LIST-BOT-TOKENS] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
