/**
 * Bot API - Get Signals
 * GET /api/bot/signals - Returns cached trade signals with full filtering
 * 
 * Query params:
 * - asset: Filter by asset (e.g. BTC, ETH)
 * - direction: Filter by direction (long, short)
 * - signal_type: Filter by signal type (standard, ta_based, ta_range, v3)
 * - min_confidence: Minimum confidence (0-1)
 * - min_rr: Minimum reward/risk ratio
 * - after: ISO timestamp - signals after this time
 * - before: ISO timestamp - signals before this time
 * - sort_by: Sort field (asset, direction, confidence, entry_price, file_timestamp, risk_reward)
 * - sort_order: Sort order (asc, desc) - default desc
 * - limit: Max signals to return
 * - newest: Convenience param - get N newest signals
 */

import { NextRequest, NextResponse } from 'next/server'
import { BotAuthService } from '@/services/BotAuthService'
import { SignalCacheService } from '@/services/SignalCacheService'
import type { BotApiResponse, SignalsResponse } from '@/types/bot-api'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest): Promise<NextResponse<BotApiResponse<SignalsResponse>>> {
  try {
    // Validate bot token
    const authHeader = request.headers.get('authorization')
    const user = await BotAuthService.validateToken(authHeader)
    
    // Check permission
    if (!BotAuthService.hasPermission(user.permissions, 'read_signals')) {
      return NextResponse.json(
        { success: false, error: 'Token does not have read_signals permission' },
        { status: 403 }
      )
    }
    
    // Update last used timestamp (non-blocking)
    BotAuthService.updateLastUsed(user.token_id)
    
    // Get query params for filtering
    const searchParams = request.nextUrl.searchParams
    const asset = searchParams.get('asset') || undefined
    const direction = searchParams.get('direction') as 'long' | 'short' | undefined
    const signal_type = searchParams.get('signal_type') || undefined
    const minConfidence = searchParams.get('min_confidence') 
      ? parseFloat(searchParams.get('min_confidence')!) 
      : undefined
    const minRR = searchParams.get('min_rr')
      ? parseFloat(searchParams.get('min_rr')!)
      : undefined
    const after = searchParams.get('after') || undefined
    const before = searchParams.get('before') || undefined
    const sortBy = searchParams.get('sort_by') as 'asset' | 'direction' | 'confidence' | 'entry_price' | 'file_timestamp' | 'risk_reward' | undefined
    const sortOrder = searchParams.get('sort_order') as 'asc' | 'desc' | undefined
    const limit = searchParams.get('limit') 
      ? parseInt(searchParams.get('limit')!) 
      : undefined
    const newest = searchParams.get('newest')
      ? parseInt(searchParams.get('newest')!)
      : undefined
    
    // Initialize cache if needed
    await SignalCacheService.initialize()
    
    // Handle special cases
    // newest=N is shorthand for sort_by=file_timestamp&sort_order=desc&limit=N
    const effectiveLimit = newest || limit
    const effectiveSortBy = newest ? 'file_timestamp' : sortBy
    const effectiveSortOrder = newest ? 'desc' : sortOrder
    
    // Get signals with filters
    const signals = SignalCacheService.getFilteredSignals({
      asset,
      direction,
      signal_type,
      minConfidence,
      minRR,
      after,
      before,
      sortBy: effectiveSortBy,
      sortOrder: effectiveSortOrder,
      limit: effectiveLimit
    })
    
    const status = SignalCacheService.getStatus()
    const uniqueAssets = SignalCacheService.getUniqueAssets()
    
    return NextResponse.json({
      success: true,
      data: {
        signals,
        count: signals.length,
        total_cached: status.signalCount,
        available_assets: uniqueAssets,
        cached_at: status.cachedAt
      }
    })
    
  } catch (error: any) {
    console.error('[Bot API] GET /signals error:', error)
    
    // Determine status code based on error
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
