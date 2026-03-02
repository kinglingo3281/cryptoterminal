/**
 * Bot API - Get Orders
 * GET /api/bot/orders - Returns user's open orders
 */

import { NextRequest, NextResponse } from 'next/server'
import { BotAuthService } from '@/services/BotAuthService'
import * as hl from '@nktkas/hyperliquid'
import type { BotApiResponse, OrdersResponse, BotOrder } from '@/types/bot-api'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest): Promise<NextResponse<BotApiResponse<OrdersResponse>>> {
  try {
    // Validate bot token
    const authHeader = request.headers.get('authorization')
    const user = await BotAuthService.validateToken(authHeader)
    
    // Check permission
    if (!BotAuthService.hasPermission(user.permissions, 'read_account')) {
      return NextResponse.json(
        { success: false, error: 'Token does not have read_account permission' },
        { status: 403 }
      )
    }
    
    // Get user's wallet address (public, for read-only operations)
    const userAddress = await BotAuthService.getUserWalletAddress(user.user_id)
    
    // Fetch orders from Hyperliquid
    const transport = new hl.HttpTransport({ isTestnet: false })
    const infoClient = new hl.InfoClient({ transport })
    
    const openOrders = await infoClient.openOrders({ user: userAddress })
    
    // Parse orders
    const orders: BotOrder[] = []
    
    if (openOrders && Array.isArray(openOrders)) {
      for (const order of openOrders) {
        const isReduceOnly = order.reduceOnly || (order as any).isPositionTpsl
        
        orders.push({
          oid: order.oid,
          asset: order.coin,
          side: order.side === 'B' ? 'BUY' : 'SELL',
          size: parseFloat(order.sz),
          price: parseFloat(order.limitPx),
          is_tpsl: (order as any).isPositionTpsl || false,
          reduce_only: isReduceOnly || false,
          cloid: order.cloid || null,
          timestamp: order.timestamp
        })
      }
    }
    
    // Update last used timestamp
    BotAuthService.updateLastUsed(user.token_id)
    
    return NextResponse.json({
      success: true,
      data: { orders }
    })
    
  } catch (error: any) {
    console.error('[Bot API] GET /orders error:', error)
    
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
