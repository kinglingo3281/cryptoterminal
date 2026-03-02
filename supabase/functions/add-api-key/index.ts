import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verifyPrivyToken, encryptAESGCM, base64Encode, base64Decode } from '../_shared/crypto.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-privy-token',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  
  try {
    const privyToken = req.headers.get('X-Privy-Token');
    if (!privyToken) {
      return new Response(JSON.stringify({ error: 'Missing Privy token' }), 
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    
    const privyUser = await verifyPrivyToken(privyToken);
    
    const body = await req.json();
    if (!body.provider || !body.label || !body.credentials) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), 
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    
    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('privy_id', privyUser.id)
      .single();
    
    if (!user) {
      return new Response(JSON.stringify({ error: 'User not found' }), 
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    
    const masterKey = base64Decode(Deno.env.get('ENCRYPTION_MASTER_KEY')!);
    const credentialsJSON = JSON.stringify(body.credentials);
    const { ciphertext, iv } = await encryptAESGCM(masterKey, credentialsJSON);
    
    const { data: savedKey, error: insertError } = await supabase
      .from('api_keys')
      .insert({
        user_id: user.id,
        provider: body.provider,
        label: body.label,
        encrypted_credentials: base64Encode(ciphertext),
        iv: base64Encode(iv)
      })
      .select()
      .single();
    
    if (insertError) {
      if (insertError.code === '23505') {
        return new Response(
          JSON.stringify({ error: 'API key with this provider and label already exists' }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      throw insertError;
    }
    
    return new Response(
      JSON.stringify({ success: true, id: savedKey.id }),
      { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
