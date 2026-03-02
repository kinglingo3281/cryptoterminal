import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-bot-token',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

// Hash token using SHA-256
async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(token)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Get bot token from header
    const botToken = req.headers.get('X-Bot-Token')
    if (!botToken) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing X-Bot-Token header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Hash the token before lookup
    const tokenHash = await hashToken(botToken)

    // Validate bot token
    const { data: tokenData, error: tokenError } = await supabase
      .from('bot_tokens')
      .select('user_id, permissions, is_revoked, expires_at')
      .eq('token_hash', tokenHash)
      .single()

    if (tokenError || !tokenData) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid bot token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (tokenData.is_revoked) {
      return new Response(
        JSON.stringify({ success: false, error: 'Token has been revoked' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (tokenData.expires_at && new Date(tokenData.expires_at) < new Date()) {
      return new Response(
        JSON.stringify({ success: false, error: 'Token has expired' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get command_id from query params
    const url = new URL(req.url)
    const commandId = url.searchParams.get('command_id')
    const timeout = parseInt(url.searchParams.get('timeout') || '10') // seconds to wait

    if (!commandId) {
      return new Response(
        JSON.stringify({ success: false, error: 'command_id query parameter required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Poll for command result
    const startTime = Date.now()
    const maxWait = timeout * 1000

    while (Date.now() - startTime < maxWait) {
      const { data: command, error: cmdError } = await supabase
        .from('bot_commands')
        .select('status, result, command_type, executed_at')
        .eq('id', commandId)
        .eq('user_id', tokenData.user_id)
        .single()

      if (cmdError) {
        return new Response(
          JSON.stringify({ success: false, error: 'Command not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Check if command has completed
      if (command.status === 'executed' || command.status === 'failed') {
        return new Response(
          JSON.stringify({
            success: command.status === 'executed',
            status: command.status,
            command_type: command.command_type,
            result: command.result,
            executed_at: command.executed_at
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Wait 200ms before polling again
      await new Promise(resolve => setTimeout(resolve, 200))
    }

    // Timeout - return current status
    const { data: finalCmd } = await supabase
      .from('bot_commands')
      .select('status, result')
      .eq('id', commandId)
      .single()

    return new Response(
      JSON.stringify({
        success: false,
        error: 'Timeout waiting for command execution',
        status: finalCmd?.status || 'unknown',
        result: finalCmd?.result
      }),
      { status: 408, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('[BOT-GET-COMMAND-RESULT] Error:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
