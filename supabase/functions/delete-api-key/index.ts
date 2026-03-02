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
    console.log('[DELETE-API-KEY] Request received');
    
    const privyToken = req.headers.get('X-Privy-Token');
    if (!privyToken) {
      console.log('[DELETE-API-KEY] ERROR: No Privy token');
      return new Response(JSON.stringify({ error: 'Missing Privy token' }), 
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    
    console.log('[DELETE-API-KEY] Verifying Privy token...');
    const privyUser = await verifyPrivyToken(privyToken);
    console.log('[DELETE-API-KEY] Privy user verified:', privyUser.id);
    
    const body = await req.json();
    if (!body.provider) {
      console.log('[DELETE-API-KEY] ERROR: Missing provider');
      return new Response(JSON.stringify({ error: 'Missing provider field' }), 
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    
    console.log('[DELETE-API-KEY] Provider to delete:', body.provider);
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id')
      .eq('privy_id', privyUser.id)
      .single();
    
    if (userError || !user) {
      console.log('[DELETE-API-KEY] ERROR: User not found');
      return new Response(JSON.stringify({ error: 'User not found' }), 
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    
    console.log('[DELETE-API-KEY] User found:', user.id);
    
    const { error: deleteError, count } = await supabase
      .from('api_keys')
      .delete({ count: 'exact' })
      .eq('user_id', user.id)
      .eq('provider', body.provider);
    
    if (deleteError) {
      console.error('[DELETE-API-KEY] Delete error:', deleteError);
      throw deleteError;
    }
    
    console.log('[DELETE-API-KEY] Deleted rows:', count);
    
    if (count === 0) {
      return new Response(
        JSON.stringify({ error: 'API key not found or already deleted' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log('[DELETE-API-KEY] Success');
    return new Response(
      JSON.stringify({ success: true, deleted: count }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('[DELETE-API-KEY] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
