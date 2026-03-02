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
    console.log('[REVOKE-BOT-TOKEN] Request received');
    
    // Verify Privy token
    const privyToken = req.headers.get('X-Privy-Token');
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
      console.error('[REVOKE-BOT-TOKEN] Privy verification error:', verifyError);
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
    
    console.log('[REVOKE-BOT-TOKEN] User verified:', privyUser.id);
    
    // Parse request body
    const body = await req.json();
    const tokenId = body.token_id;
    
    if (!tokenId) {
      return new Response(
        JSON.stringify({ success: false, error: 'token_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    
    // DELETE token (only if owned by this user) - users only get 1 key at a time
    console.log('[REVOKE-BOT-TOKEN] Deleting token:', tokenId);
    
    const { error } = await supabase
      .from('bot_tokens')
      .delete()
      .eq('id', tokenId)
      .eq('user_id', privyUser.id);
    
    if (error) {
      console.error('[REVOKE-BOT-TOKEN] Delete error:', error);
      throw new Error('Failed to delete token');
    }
    
    console.log('[REVOKE-BOT-TOKEN] Token deleted successfully');
    
    return new Response(
      JSON.stringify({ success: true, message: 'Token deleted' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('[REVOKE-BOT-TOKEN] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
