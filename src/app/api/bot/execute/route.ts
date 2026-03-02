/**
 * Bot API - Execute Trade
 * POST /api/bot/execute - Publish execute command to browser
 * 
 * Clawdbot calls this → Command published to Supabase → Browser executes locally
 */

import { NextRequest, NextResponse } from 'next/server'
import { BotAuthService } from '@/services/BotAuthService'
import type { BotApiResponse, ExecuteTradeRequest } from '@/types/bot-api'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest): Promise<NextResponse<BotApiResponse<{ command_id: string; message: string }>>> {
  try {
    // Validate bot token
    const authHeader = request.headers.get('authorization')
    const user = await BotAuthService.validateToken(authHeader)
    
    // Check permission
    if (!BotAuthService.hasPermission(user.permissions, 'execute_trades')) {
      return NextResponse.json(
        { success: false, error: 'Token does not have execute_trades permission' },
        { status: 403 }
      )
    }
    
    // Parse request body
    const body: ExecuteTradeRequest = await request.json()
    
    // Validate: need either signal_id or asset/direction
    if (!body.signal_id && !body.asset && !body.direction) {
      return NextResponse.json(
        { success: false, error: 'Must provide signal_id or asset/direction criteria' },
        { status: 400 }
      )
    }
    
    // Build payload - supports both exact ID and criteria-based lookup
    const payload: any = {
      position_size: body.position_size || '2.5%',
      scale_up: body.scale_up !== false
    }
    
    if (body.signal_id) {
      payload.signal_id = body.signal_id
    } else {
      if (body.asset) payload.asset = body.asset
      if (body.direction) payload.direction = body.direction
      // Default to newest signal matching criteria
      payload.select = body.select || 'newest'
    }
    
    // Publish command to Supabase (browser will pick up via realtime)
    const response = await fetch(`${SUPABASE_URL}/rest/v1/bot_commands`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        user_id: user.user_id,
        command_type: 'execute',
        payload,
        status: 'pending'
      })
    })
    
    if (!response.ok) {
      throw new Error('Failed to publish command')
    }
    
    const [command] = await response.json()
    
    // Update last used timestamp
    BotAuthService.updateLastUsed(user.token_id)
    
    return NextResponse.json({
      success: true,
      data: {
        command_id: command.id,
        message: 'Command sent to browser. Execution pending.'
      }
    })
    
  } catch (error: any) {
    console.error('[Bot API] POST /execute error:', error)
    
    let statusCode = 500
    if (error.message.includes('Authorization') || error.message.includes('token')) {
      statusCode = 401
    }
    
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: statusCode }
    )
  }
}
