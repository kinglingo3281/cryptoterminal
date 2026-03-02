/**
 * Bot API - Signal Sync
 * POST /api/bot/signals/sync - Client pushes signals to server cache
 * 
 * Called by browser client when it receives signals from SSE.
 * This allows the bot API to access the same signals without
 * connecting directly to SSE source (which blocks non-app origins).
 */

import { NextRequest, NextResponse } from 'next/server'
import { SignalCacheService } from '@/services/SignalCacheService'
import type { TradeSignal } from '@/hooks/useTradeDataManager'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Parse signals from body
    const body = await request.json()
    const signals: TradeSignal[] = body.signals || body
    
    if (!Array.isArray(signals)) {
      return NextResponse.json(
        { success: false, error: 'signals must be an array' },
        { status: 400 }
      )
    }
    
    // Add signals to cache
    SignalCacheService.addSignals(signals)
    
    const status = SignalCacheService.getStatus()
    
    return NextResponse.json({
      success: true,
      data: {
        received: signals.length,
        total: status.signalCount,
        cached_at: status.cachedAt
      }
    })
    
  } catch (error: any) {
    console.error('[Bot API] POST /signals/sync error:', error)
    
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to sync signals' },
      { status: 500 }
    )
  }
}
