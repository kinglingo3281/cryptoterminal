/**
 * Bot API - Signal Stream (SSE)
 * GET /api/bot/signals/stream - Real-time signal stream via Server-Sent Events
 */

import { NextRequest } from 'next/server'
import { BotAuthService } from '@/services/BotAuthService'
import { SignalCacheService } from '@/services/SignalCacheService'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    // Validate bot token
    const authHeader = request.headers.get('authorization')
    const user = await BotAuthService.validateToken(authHeader)
    
    // Check permission
    if (!BotAuthService.hasPermission(user.permissions, 'read_signals')) {
      return new Response(
        JSON.stringify({ success: false, error: 'Token does not have read_signals permission' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      )
    }
    
    // Update last used timestamp
    BotAuthService.updateLastUsed(user.token_id)
    
    // Initialize signal cache
    await SignalCacheService.initialize()
    
    // Create SSE stream
    const encoder = new TextEncoder()
    let lastSignalIds = new Set<string>()
    let isActive = true
    
    const stream = new ReadableStream({
      async start(controller) {
        // Send initial connection event
        controller.enqueue(encoder.encode(`event: connected\ndata: {"message": "Connected to signal stream"}\n\n`))
        
        // Send current signals
        const { signals } = SignalCacheService.getSignals()
        if (signals.length > 0) {
          controller.enqueue(encoder.encode(`event: signals\ndata: ${JSON.stringify({ signals, count: signals.length })}\n\n`))
          lastSignalIds = new Set(signals.map(s => s.id))
        }
        
        // Poll for new signals every 5 seconds
        const interval = setInterval(async () => {
          if (!isActive) {
            clearInterval(interval)
            return
          }
          
          try {
            // Refresh signals from source
            await SignalCacheService.refreshSignals()
            
            const { signals: currentSignals } = SignalCacheService.getSignals()
            
            // Find new signals
            const newSignals = currentSignals.filter(s => !lastSignalIds.has(s.id))
            
            if (newSignals.length > 0) {
              controller.enqueue(encoder.encode(`event: new_signals\ndata: ${JSON.stringify({ signals: newSignals, count: newSignals.length })}\n\n`))
              
              // Update tracking
              lastSignalIds = new Set(currentSignals.map(s => s.id))
            }
            
            // Send heartbeat
            controller.enqueue(encoder.encode(`event: heartbeat\ndata: {"timestamp": ${Date.now()}}\n\n`))
            
          } catch (error) {
            console.error('[Bot API] SSE stream error:', error)
          }
        }, 5000)
        
        // Handle client disconnect
        request.signal.addEventListener('abort', () => {
          isActive = false
          clearInterval(interval)
          controller.close()
        })
      },
      
      cancel() {
        isActive = false
      }
    })
    
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
      }
    })
    
  } catch (error: any) {
    console.error('[Bot API] GET /signals/stream error:', error)
    
    let statusCode = 500
    if (error.message.includes('Authorization') || error.message.includes('token')) {
      statusCode = 401
    }
    
    return new Response(
      JSON.stringify({ success: false, error: error.message || 'Internal server error' }),
      { status: statusCode, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
