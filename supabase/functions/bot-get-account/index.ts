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
  
  const { data: tokens } = await supabase
    .from('bot_tokens')
    .select('*')
    .eq('token_hash', tokenHash);
  
  if (!tokens || tokens.length === 0) {
    throw new Error('Invalid token');
  }
  
  const token = tokens[0];
  
  if (token.is_revoked) throw new Error('Token has been revoked');
  if (token.expires_at && new Date(token.expires_at) < new Date()) throw new Error('Token has expired');
  
  // Update last_used_at
  supabase.from('bot_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', token.id).then(() => {});
  
  // Get wallet address
  const { data: users } = await supabase.from('users').select('wallet_address').eq('privy_id', token.user_id);
  
  return {
    user_id: token.user_id,
    token_id: token.id,
    permissions: token.permissions,
    wallet_address: users?.[0]?.wallet_address || null
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
    
    if (!user.permissions.read_account) {
      return new Response(
        JSON.stringify({ success: false, error: 'Token does not have read_account permission' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    if (!user.wallet_address) {
      return new Response(
        JSON.stringify({ success: false, error: 'No wallet address found for user' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Get endpoint type from URL
    const url = new URL(req.url);
    const endpoint = url.searchParams.get('type') || 'account'; // account, positions, orders, history
    
    // Fetch from Hyperliquid API
    const hlResponse = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: endpoint === 'history' ? 'userFills' : 'clearinghouseState',
        user: user.wallet_address
      })
    });
    
    if (!hlResponse.ok) {
      throw new Error('Failed to fetch from Hyperliquid');
    }
    
    const hlData = await hlResponse.json();
    
    // Format response based on endpoint type
    let responseData: any = {};
    
    if (endpoint === 'account') {
      const marginSummary = hlData.marginSummary || {};
      // Use crossMarginSummary for accurate available balance (works with isolated margin)
      const crossMargin = hlData.crossMarginSummary || marginSummary;
      const crossAccountValue = parseFloat(crossMargin.accountValue || '0');
      const crossMarginUsed = parseFloat(crossMargin.totalMarginUsed || '0');
      const availableForTrading = crossAccountValue - crossMarginUsed;
      
      responseData = {
        account: {
          account_value: parseFloat(marginSummary.accountValue || '0'),
          available_balance: availableForTrading,
          margin_used: parseFloat(marginSummary.totalMarginUsed || '0'),
          unrealized_pnl: parseFloat(marginSummary.totalNtlPos || '0'),
          withdrawable: parseFloat(hlData.withdrawable || '0')
        }
      };
    } else if (endpoint === 'positions') {
      const positions = (hlData.assetPositions || [])
        .filter((p: any) => parseFloat(p.position?.szi || '0') !== 0)
        .map((p: any) => ({
          asset: p.position.coin,
          size: Math.abs(parseFloat(p.position.szi || '0')),
          side: parseFloat(p.position.szi || '0') > 0 ? 'LONG' : 'SHORT',
          entry_price: parseFloat(p.position.entryPx || '0'),
          unrealized_pnl: parseFloat(p.position.unrealizedPnl || '0'),
          leverage: parseFloat(p.position.leverage?.value || '0'),
          liquidation_price: parseFloat(p.position.liquidationPx || '0')
        }));
      responseData = { positions };
    } else if (endpoint === 'orders') {
      // Need separate call for open orders
      const ordersResponse = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'openOrders', user: user.wallet_address })
      });
      const ordersData = await ordersResponse.json();
      
      const orders = (ordersData || []).map((o: any) => ({
        oid: o.oid,
        asset: o.coin,
        side: o.side === 'B' ? 'BUY' : 'SELL',
        size: parseFloat(o.sz || '0'),
        price: parseFloat(o.limitPx || '0'),
        reduce_only: o.reduceOnly || false
      }));
      responseData = { orders };
    } else if (endpoint === 'history') {
      const fills = (hlData || []).slice(0, 100).map((f: any) => ({
        tid: f.tid,
        time: f.time,
        asset: f.coin,
        side: f.side === 'B' ? 'BUY' : 'SELL',
        price: parseFloat(f.px || '0'),
        size: parseFloat(f.sz || '0'),
        closed_pnl: parseFloat(f.closedPnl || '0'),
        fee: parseFloat(f.fee || '0')
      }));
      responseData = { fills, count: fills.length };
    } else if (endpoint === 'balances') {
      // Fetch spot balances
      const spotResponse = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'spotClearinghouseState', user: user.wallet_address })
      });
      const spotData = await spotResponse.json();
      
      const balances = (spotData?.balances || []).map((b: any) => ({
        coin: b.coin,
        total: parseFloat(b.total || '0'),
        hold: parseFloat(b.hold || '0'),
        available: parseFloat(b.total || '0') - parseFloat(b.hold || '0')
      }));
      responseData = { balances };
    }
    
    return new Response(
      JSON.stringify({ success: true, data: responseData }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('[BOT-GET-ACCOUNT] Error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    const status = message.includes('token') ? 401 : 500;
    
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
