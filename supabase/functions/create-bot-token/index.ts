import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verifyPrivyToken } from '../_shared/crypto.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-privy-token',
};

// Hash token using SHA-256
async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Generate random token
function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  
  try {
    console.log('[CREATE-BOT-TOKEN] Request received');
    
    // Verify Privy token (user must be logged in)
    const privyToken = req.headers.get('X-Privy-Token');
    if (!privyToken) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing Privy token. Please login first.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const privyUser = await verifyPrivyToken(privyToken);
    if (!privyUser || !privyUser.id) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid Privy token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log('[CREATE-BOT-TOKEN] User verified:', privyUser.id);
    
    // Store in Supabase
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    
    // Check if user already has a token (only 1 allowed)
    console.log('[CREATE-BOT-TOKEN] Checking for existing tokens for user:', privyUser.id);
    
    const { data: existingTokens, error: checkError } = await supabase
      .from('bot_tokens')
      .select('id')
      .eq('user_id', privyUser.id);
    
    console.log('[CREATE-BOT-TOKEN] Existing tokens check:', { count: existingTokens?.length, error: checkError });
    
    if (checkError) {
      console.error('[CREATE-BOT-TOKEN] Error checking existing tokens:', checkError);
      throw new Error('Failed to check existing tokens');
    }
    
    if (existingTokens && existingTokens.length > 0) {
      console.log('[CREATE-BOT-TOKEN] User already has token, rejecting');
      return new Response(
        JSON.stringify({ success: false, error: 'You already have an API token. Delete it first to create a new one.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Parse request body
    const body = await req.json().catch(() => ({}));
    const label = body.label || null;
    const expiresInDays = body.expires_in_days || null;
    const permissions = {
      read_signals: true,
      execute_trades: true,
      read_account: true,
      cancel_orders: true,
      close_positions: true,
      ...(body.permissions || {})
    };
    
    // Calculate expiry
    let expiresAt = null;
    if (expiresInDays) {
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + expiresInDays);
      expiresAt = expiry.toISOString();
    }
    
    // Generate and hash token
    const rawToken = generateToken();
    const tokenHash = await hashToken(rawToken);
    
    // Insert new token
    const { data: tokenData, error } = await supabase
      .from('bot_tokens')
      .insert({
        user_id: privyUser.id,
        token_hash: tokenHash,
        label,
        permissions,
        expires_at: expiresAt
      })
      .select('id')
      .single();
    
    if (error) {
      console.error('[CREATE-BOT-TOKEN] Insert error:', error);
      throw new Error('Failed to create token');
    }
    
    console.log('[CREATE-BOT-TOKEN] Token created:', tokenData.id);
    
    // Return raw token (only shown once!)
    return new Response(
      JSON.stringify({
        success: true,
        data: {
          token: rawToken,
          token_id: tokenData.id,
          expires_at: expiresAt
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('[CREATE-BOT-TOKEN] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
