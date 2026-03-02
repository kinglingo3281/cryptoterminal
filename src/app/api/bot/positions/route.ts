/**
 * Bot API - Get Positions
 * GET /api/bot/positions - Returns user's open positions
 */

import { NextRequest, NextResponse } from 'next/server'
import { BotAuthService } from '@/services/BotAuthService'
import * as hl from '@nktkas/hyperliquid'
import type { BotApiResponse, PositionsResponse, BotPosition } from '@/types/bot-api'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest): Promise<NextResponse<BotApiResponse<PositionsResponse>>> {
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
    
    // Fetch positions from Hyperliquid
    const transport = new hl.HttpTransport({ isTestnet: false })
    const infoClient = new hl.InfoClient({ transport })
    
    const userState = await infoClient.clearinghouseState({ user: userAddress })
    
    // Parse positions
    const positions: BotPosition[] = []
    
    if (userState?.assetPositions) {
      for (const assetPos of userState.assetPositions) {
        const pos = assetPos.position
        if (pos && Math.abs(parseFloat(pos.szi)) > 0) {
          const size = parseFloat(pos.szi)
          
          let liquidationPrice: number | undefined
          if (pos.liquidationPx && pos.liquidationPx !== 'null') {
            const parsed = parseFloat(pos.liquidationPx)
            if (!isNaN(parsed) && parsed > 0) {
              liquidationPrice = parsed
            }
          }
          
          positions.push({
            asset: pos.coin,
            size: Math.abs(size),
            side: size > 0 ? 'LONG' : 'SHORT',
            entry_price: parseFloat(pos.entryPx || '0'),
            unrealized_pnl: parseFloat(pos.unrealizedPnl || '0'),
            leverage: parseFloat(String(pos.leverage?.value || '1')),
            liquidation_price: liquidationPrice,
            tp: null,
            sl: null
          })
        }
      }
    }
    
    // Try to match TP/SL from open orders
    const openOrders = await infoClient.openOrders({ user: userAddress })
    
    if (openOrders && Array.isArray(openOrders)) {
      for (const order of openOrders) {
        if ((order as any).isPositionTpsl) {
          const position = positions.find(p => p.asset === order.coin)
          if (position) {
            const orderPrice = parseFloat(order.limitPx)
            const isLong = position.side === 'LONG'
            const isProfitable = isLong 
              ? orderPrice > position.entry_price 
              : orderPrice < position.entry_price
            
            if (isProfitable) {
              position.tp = orderPrice
            } else {
              position.sl = orderPrice
            }
          }
        }
      }
    }
    
    // Update last used timestamp
    BotAuthService.updateLastUsed(user.token_id)
    
    return NextResponse.json({
      success: true,
      data: { positions }
    })
    
  } catch (error: any) {
    console.error('[Bot API] GET /positions error:', error)
    
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
