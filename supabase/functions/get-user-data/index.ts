import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verifyPrivyToken, decryptAESGCM, base64Decode } from '../_shared/crypto.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-privy-token',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  
  try {
    console.log('[GET-USER-DATA] Request received');
    const privyToken = req.headers.get('X-Privy-Token');
    console.log('[GET-USER-DATA] Privy token present:', !!privyToken);
    
    if (!privyToken) {
      console.log('[GET-USER-DATA] ERROR: No Privy token');
      return new Response(JSON.stringify({ error: 'Missing Privy token' }), 
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    
    console.log('[GET-USER-DATA] Token length:', privyToken.length);
    console.log('[GET-USER-DATA] PRIVY_APP_ID present:', !!Deno.env.get('PRIVY_APP_ID'));
    console.log('[GET-USER-DATA] Calling verifyPrivyToken...');
    
    const privyUser = await verifyPrivyToken(privyToken);
    console.log('[GET-USER-DATA] Privy user response:', JSON.stringify(privyUser));
    
    if (!privyUser || !privyUser.id) {
      console.log('[GET-USER-DATA] ERROR: Invalid Privy user response');
      return new Response(JSON.stringify({ error: 'Invalid Privy user data' }), 
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    
    console.log('[GET-USER-DATA] Privy user verified:', privyUser.id);
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    
    let { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('privy_id', privyUser.id)
      .single();
    
    if (!user) {
      const { data: newUser } = await supabase
        .from('users')
        .insert({
          privy_id: privyUser.id,
          email: privyUser.email?.address || null,
          wallet_address: privyUser.wallet?.address || null
        })
        .select()
        .single();
      user = newUser;
    }
    
    const { data: encryptedKeys } = await supabase
      .from('api_keys')
      .select('*')
      .eq('user_id', user.id);
    
    const masterKey = base64Decode(Deno.env.get('ENCRYPTION_MASTER_KEY')!);
    const decryptedKeys: { [key: string]: any } = {};
    
    for (const row of encryptedKeys || []) {
      try {
        const plaintext = await decryptAESGCM(
          masterKey,
          base64Decode(row.encrypted_credentials),
          base64Decode(row.iv)
        );
        decryptedKeys[row.provider] = JSON.parse(plaintext);
      } catch (error) {
        console.error(`Failed to decrypt key for ${row.provider}:`, error);
      }
    }
    
    return new Response(
      JSON.stringify({ user, api_keys: decryptedKeys }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
