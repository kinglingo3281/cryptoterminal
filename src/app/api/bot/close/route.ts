/**
 * Bot API - Close Position
 * POST /api/bot/close - Publish close command to browser
 * 
 * Clawdbot calls this → Command published to Supabase → Browser executes locally
 */

import { NextRequest, NextResponse } from 'next/server'
import { BotAuthService } from '@/services/BotAuthService'
import type { BotApiResponse, ClosePositionRequest } from '@/types/bot-api'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest): Promise<NextResponse<BotApiResponse<{ command_id: string; message: string }>>> {
  try {
    // Validate bot token
    const authHeader = request.headers.get('authorization')
    const user = await BotAuthService.validateToken(authHeader)
    
    // Check permission
    if (!BotAuthService.hasPermission(user.permissions, 'close_positions')) {
      return NextResponse.json(
        { success: false, error: 'Token does not have close_positions permission' },
        { status: 403 }
      )
    }
    
    // Parse request body
    const body: ClosePositionRequest = await request.json()
    
    if (!body.asset) {
      return NextResponse.json(
        { success: false, error: 'asset is required' },
        { status: 400 }
      )
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
        command_type: 'close',
        payload: {
          asset: body.asset
        },
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
        message: 'Close command sent to browser. Execution pending.'
      }
    })
    
  } catch (error: any) {
    console.error('[Bot API] POST /close error:', error)
    
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
