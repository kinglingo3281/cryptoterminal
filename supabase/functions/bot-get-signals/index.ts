import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-bot-token, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(token)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

async function validateBotToken(authHeader: string, supabase: any) {
  let rawToken = authHeader
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    rawToken = authHeader.substring(7)
  }
  
  if (!rawToken || rawToken.length < 32) {
    throw new Error('Invalid token format')
  }
  
  const tokenHash = await hashToken(rawToken)
  
  const { data: tokens, error } = await supabase
    .from('bot_tokens')
    .select('*')
    .eq('token_hash', tokenHash)
  
  if (error || !tokens || tokens.length === 0) {
    throw new Error('Invalid token')
  }
  
  const token = tokens[0]
  
  if (token.is_revoked) {
    throw new Error('Token has been revoked')
  }
  
  if (token.expires_at && new Date(token.expires_at) < new Date()) {
    throw new Error('Token has expired')
  }
  
  // Update last_used_at
  supabase
    .from('bot_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', token.id)
    .then(() => {})
  
  return {
    user_id: token.user_id,
    token_id: token.id,
    permissions: token.permissions
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )
    
    // Validate bot token - prefer X-Bot-Token
    const authHeader = req.headers.get('X-Bot-Token') || req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing Authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    
    const user = await validateBotToken(authHeader, supabase)
    
    // Check read_signals permission
    if (!user.permissions.read_signals) {
      return new Response(
        JSON.stringify({ success: false, error: 'Token does not have read_signals permission' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    
    // Parse query params for filters
    const url = new URL(req.url)
    const filters: any = {}
    
    if (url.searchParams.get('asset')) filters.asset = url.searchParams.get('asset')
    if (url.searchParams.get('direction')) filters.direction = url.searchParams.get('direction')
    if (url.searchParams.get('signal_type')) filters.signal_type = url.searchParams.get('signal_type')
    if (url.searchParams.get('min_confidence')) filters.min_confidence = parseFloat(url.searchParams.get('min_confidence')!)
    if (url.searchParams.get('min_rr')) filters.min_rr = parseFloat(url.searchParams.get('min_rr')!)
    if (url.searchParams.get('limit')) filters.limit = parseInt(url.searchParams.get('limit')!)
    if (url.searchParams.get('newest')) {
      filters.newest = parseInt(url.searchParams.get('newest')!)
      filters.limit = filters.newest // newest is shorthand for limit + sort by timestamp
    }
    
    // Generate request ID
    const requestId = crypto.randomUUID()
    const responseChannelName = `signal_request_${requestId}`
    
    console.log(`[BOT-GET-SIGNALS] Request ${requestId} for user ${user.user_id}`)
    
    // Create channels
    const responseChannel = supabase.channel(responseChannelName)
    const requestChannel = supabase.channel('signal_requests')
    
    // Set up promise to wait for response
    const responsePromise = new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Request timeout - browser may be offline'))
      }, 10000) // 10 second timeout
      
      let responseSubscribed = false
      let requestSubscribed = false
      
      // Subscribe to response channel
      responseChannel
        .on('broadcast', { event: 'response' }, (payload: any) => {
          clearTimeout(timeout)
          resolve(payload.payload)
        })
        .subscribe((status: string) => {
          if (status === 'SUBSCRIBED') {
            responseSubscribed = true
            checkAndBroadcast()
          }
        })
      
      // Subscribe to request channel for sending
      requestChannel.subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          requestSubscribed = true
          checkAndBroadcast()
        }
      })
      
      // Only broadcast once both channels are ready
      async function checkAndBroadcast() {
        if (responseSubscribed && requestSubscribed) {
          await requestChannel.send({
            type: 'broadcast',
            event: 'request',
            payload: {
              request_id: requestId,
              user_id: user.user_id,
              filters
            }
          })
        }
      }
    })
    
    // Wait for response
    const response = await responsePromise
    
    // Cleanup both channels
    await supabase.removeChannel(responseChannel)
    await supabase.removeChannel(requestChannel)
    
    console.log(`[BOT-GET-SIGNALS] Response received: ${response.signals?.length || 0} signals`)
    
    return new Response(
      JSON.stringify({
        success: true,
        data: {
          signals: response.signals || [],
          count: response.count || 0,
          cached_at: response.cached_at || new Date().toISOString()
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
    
  } catch (error) {
    console.error('[BOT-GET-SIGNALS] Error:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    const status = message.includes('token') ? 401 : 
                   message.includes('permission') ? 403 : 
                   message.includes('timeout') ? 504 : 500
    
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
