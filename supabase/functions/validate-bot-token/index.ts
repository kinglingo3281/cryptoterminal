import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-bot-token',
};

// Hash token using SHA-256
async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  
  try {
    // Get bot token from header - prefer X-Bot-Token, fallback to Authorization
    const authHeader = req.headers.get('X-Bot-Token') || req.headers.get('Authorization');
    
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing Authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Extract token from "Bearer <token>" format
    let rawToken = authHeader;
    if (authHeader.toLowerCase().startsWith('bearer ')) {
      rawToken = authHeader.substring(7);
    }
    
    if (!rawToken || rawToken.length < 32) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid token format' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Hash the token
    const tokenHash = await hashToken(rawToken);
    
    // Look up in Supabase
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    
    const { data: tokens, error } = await supabase
      .from('bot_tokens')
      .select('*')
      .eq('token_hash', tokenHash);
    
    if (error || !tokens || tokens.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const token = tokens[0];
    
    // Check if revoked
    if (token.is_revoked) {
      return new Response(
        JSON.stringify({ success: false, error: 'Token has been revoked' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Check expiry
    if (token.expires_at && new Date(token.expires_at) < new Date()) {
      return new Response(
        JSON.stringify({ success: false, error: 'Token has expired' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Update last_used_at (fire and forget)
    supabase
      .from('bot_tokens')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', token.id)
      .then(() => {});
    
    // Get user's wallet address
    const { data: users } = await supabase
      .from('users')
      .select('wallet_address')
      .eq('privy_id', token.user_id);
    
    const walletAddress = users?.[0]?.wallet_address || null;
    
    // Return validated user info
    return new Response(
      JSON.stringify({
        success: true,
        user_id: token.user_id,
        token_id: token.id,
        permissions: token.permissions,
        wallet_address: walletAddress
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('[VALIDATE-BOT-TOKEN] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
