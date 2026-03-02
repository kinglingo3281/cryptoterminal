/**
 * Bot API - Place Order
 * POST /api/bot/order - Publish order command to browser
 * 
 * Clawdbot calls this → Command published to Supabase → Browser executes locally
 */

import { NextRequest, NextResponse } from 'next/server'
import { BotAuthService } from '@/services/BotAuthService'
import type { BotApiResponse, PlaceOrderRequest } from '@/types/bot-api'

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
    const body: PlaceOrderRequest = await request.json()
    
    // Validate required fields
    if (!body.asset) {
      return NextResponse.json(
        { success: false, error: 'asset is required' },
        { status: 400 }
      )
    }
    
    if (!body.side || !['buy', 'sell'].includes(body.side)) {
      return NextResponse.json(
        { success: false, error: 'side must be "buy" or "sell"' },
        { status: 400 }
      )
    }
    
    if (!body.type || !['market', 'limit'].includes(body.type)) {
      return NextResponse.json(
        { success: false, error: 'type must be "market" or "limit"' },
        { status: 400 }
      )
    }
    
    if (!body.size || body.size <= 0) {
      return NextResponse.json(
        { success: false, error: 'size must be a positive number' },
        { status: 400 }
      )
    }
    
    if (body.type === 'limit' && !body.price) {
      return NextResponse.json(
        { success: false, error: 'price is required for limit orders' },
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
        command_type: 'order',
        payload: {
          asset: body.asset,
          side: body.side,
          type: body.type,
          size: body.size,
          price: body.price,
          leverage: body.leverage || 20,
          reduce_only: body.reduce_only || false,
          tp_price: body.tp_price,
          sl_price: body.sl_price
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
        message: 'Order command sent to browser. Execution pending.'
      }
    })
    
  } catch (error: any) {
    console.error('[Bot API] POST /order error:', error)
    
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
