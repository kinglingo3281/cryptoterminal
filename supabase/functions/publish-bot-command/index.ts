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

// Validate bot token and return user info
async function validateBotToken(authHeader: string, supabase: any) {
  let rawToken = authHeader;
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    rawToken = authHeader.substring(7);
  }
  
  if (!rawToken || rawToken.length < 32) {
    throw new Error('Invalid token format');
  }
  
  const tokenHash = await hashToken(rawToken);
  
  const { data: tokens, error } = await supabase
    .from('bot_tokens')
    .select('*')
    .eq('token_hash', tokenHash);
  
  if (error || !tokens || tokens.length === 0) {
    throw new Error('Invalid token');
  }
  
  const token = tokens[0];
  
  if (token.is_revoked) {
    throw new Error('Token has been revoked');
  }
  
  if (token.expires_at && new Date(token.expires_at) < new Date()) {
    throw new Error('Token has expired');
  }
  
  // Update last_used_at
  supabase
    .from('bot_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', token.id)
    .then(() => {});
  
  return {
    user_id: token.user_id,
    token_id: token.id,
    permissions: token.permissions
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    
    // Validate bot token - prefer X-Bot-Token since Authorization has Supabase anon key
    const authHeader = req.headers.get('X-Bot-Token') || req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing Authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const user = await validateBotToken(authHeader, supabase);
    
    // Parse request body
    const body = await req.json();
    const { command_type, payload } = body;
    
    if (!command_type) {
      return new Response(
        JSON.stringify({ success: false, error: 'command_type is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Check permissions based on command type
    const permissions = user.permissions;
    
    // Commands requiring execute_trades permission
    const executeTradesCommands = ['execute', 'order', 'start_chase', 'start_grid', 'modify_order', 'modify_tpsl', 'chase_order',
      'bot_start', 'bot_stop', 'set_autotrade_mode', 'set_position_size', 'set_advanced_filters', 'set_blacklist'];
    if (executeTradesCommands.includes(command_type) && !permissions.execute_trades) {
      return new Response(
        JSON.stringify({ success: false, error: 'Token does not have execute_trades permission' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Commands requiring cancel_orders permission
    const cancelOrdersCommands = ['cancel', 'cancel_all', 'stop_chase', 'stop_all_chases', 'stop_grid'];
    if (cancelOrdersCommands.includes(command_type) && !permissions.cancel_orders) {
      return new Response(
        JSON.stringify({ success: false, error: 'Token does not have cancel_orders permission' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Commands requiring close_positions permission
    const closePositionsCommands = ['close', 'close_all'];
    if (closePositionsCommands.includes(command_type) && !permissions.close_positions) {
      return new Response(
        JSON.stringify({ success: false, error: 'Token does not have close_positions permission' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Commands requiring read_account permission (read-only)
    const readOnlyCommands = ['get_chases', 'get_grids', 'get_alpha_data', 'get_signal_details', 'get_funding_pairs', 'get_atr', 'get_symbols',
      'bot_status', 'get_autotrade_settings', 'get_logs'];
    if (readOnlyCommands.includes(command_type) && !permissions.read_account) {
      return new Response(
        JSON.stringify({ success: false, error: 'Token does not have read_account permission' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Validate command_type is known
    const validCommands = [
      'execute', 'order', 'cancel', 'close',
      'cancel_all', 'close_all',
      'start_chase', 'stop_chase', 'stop_all_chases',
      'start_grid', 'stop_grid',
      'modify_order', 'modify_tpsl',
      'get_chases', 'get_grids',
      'chase_order',
      'get_alpha_data', 'get_signal_details', 'get_funding_pairs', 'get_atr', 'get_symbols',
      // Bot Control
      'bot_start', 'bot_stop', 'bot_status',
      // Settings
      'get_autotrade_settings', 'set_autotrade_mode', 'set_position_size', 'set_advanced_filters', 'set_blacklist',
      // Logs
      'get_logs'
    ];
    if (!validCommands.includes(command_type)) {
      return new Response(
        JSON.stringify({ success: false, error: `Unknown command_type: ${command_type}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Insert command into bot_commands table
    const { data: command, error } = await supabase
      .from('bot_commands')
      .insert({
        user_id: user.user_id,
        command_type,
        payload: payload || {},
        status: 'pending'
      })
      .select('id')
      .single();
    
    if (error) {
      console.error('[PUBLISH-BOT-COMMAND] Insert error:', error);
      throw new Error('Failed to publish command');
    }
    
    console.log('[PUBLISH-BOT-COMMAND] Command published:', command.id);
    
    // For read-only commands, wait for result and return it directly
    if (readOnlyCommands.includes(command_type)) {
      const timeout = 15000; // 15 second timeout
      const startTime = Date.now();
      const pollInterval = 200;
      
      while (Date.now() - startTime < timeout) {
        const { data: cmdResult } = await supabase
          .from('bot_commands')
          .select('status, result')
          .eq('id', command.id)
          .single();
        
        if (cmdResult && (cmdResult.status === 'executed' || cmdResult.status === 'failed')) {
          return new Response(
            JSON.stringify({
              success: cmdResult.status === 'executed',
              command_id: command.id,
              ...cmdResult.result
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
      
      // Timeout - return command_id so user can poll manually
      return new Response(
        JSON.stringify({
          success: false,
          command_id: command.id,
          error: 'Timeout waiting for browser to execute. Use bot-get-command-result to poll.'
        }),
        { status: 408, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // For write commands, return immediately
    return new Response(
      JSON.stringify({
        success: true,
        command_id: command.id,
        message: 'Command published. Browser will execute when online.'
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('[PUBLISH-BOT-COMMAND] Error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    const status = message.includes('token') ? 401 : 500;
    
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
