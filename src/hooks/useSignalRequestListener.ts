'use client'

/**
 * Signal Request Listener Hook
 * Listens for signal requests from bot via Supabase Realtime
 * Responds with filtered signals from SSEProvider
 */

import { useEffect, useCallback, useRef } from 'react'
import { getBrowserSupabaseClient } from '@/lib/supabaseBrowserClient'
import { useUserStore } from '@/store/useUserStore'
import { useSSEData } from '@/providers/SSEProvider'
import type { TradeSignal } from '@/hooks/useTradeDataManager'

const LOG_SIGNAL_LISTENER = false

const log = (...args: unknown[]) => {
  if (LOG_SIGNAL_LISTENER) {
    console.log(...args)
  }
}

interface SignalRequest {
  request_id: string
  user_id: string
  filters: {
    asset?: string
    direction?: 'long' | 'short'
    signal_type?: string
    min_confidence?: number
    min_rr?: number
    limit?: number
    newest?: number
  }
}

export function useSignalRequestListener() {
  const { user } = useUserStore()
  const { allTrades, isConnected } = useSSEData()
  const supabaseRef = useRef<any>(null)

  // Calculate reward/risk ratio
  const calculateRR = useCallback((signal: TradeSignal): number => {
    const entry = signal.entry_price
    const tp = signal.target_price
    const sl = signal.stop_price
    
    if (!entry || !tp || !sl) return 0
    
    const reward = Math.abs(tp - entry)
    const risk = Math.abs(entry - sl)
    
    return risk === 0 ? 0 : reward / risk
  }, [])

  // Filter signals based on request
  const filterSignals = useCallback((request: SignalRequest): TradeSignal[] => {
    let filtered = [...allTrades]
    const { filters } = request
    
    // Filter by asset
    if (filters.asset) {
      filtered = filtered.filter(s => s.asset === filters.asset)
    }
    
    // Filter by direction
    if (filters.direction) {
      filtered = filtered.filter(s => s.direction === filters.direction)
    }
    
    // Filter by signal type
    if (filters.signal_type) {
      filtered = filtered.filter(s => s.signal_type === filters.signal_type)
    }
    
    // Filter by min confidence
    if (filters.min_confidence !== undefined) {
      filtered = filtered.filter(s => (s.confidence || 0) >= filters.min_confidence!)
    }
    
    // Filter by min reward/risk
    if (filters.min_rr !== undefined && filters.min_rr > 0) {
      filtered = filtered.filter(s => calculateRR(s) >= filters.min_rr!)
    }
    
    // Sort by timestamp (newest first)
    filtered.sort((a, b) => {
      const timeA = new Date(a.file_timestamp || a.created_at || 0).getTime()
      const timeB = new Date(b.file_timestamp || b.created_at || 0).getTime()
      return timeB - timeA
    })
    
    // Limit results
    const limit = filters.newest || filters.limit || 100
    return filtered.slice(0, limit)
    
  }, [allTrades, calculateRR])

  // Handle incoming signal request
  const handleRequest = useCallback(async (payload: any) => {
    const request = payload.payload as SignalRequest
    
    log('[SignalListener] Received request:', request.request_id, 'Filters:', request.filters)
    
    // Only respond if this is for current user
    if (request.user_id !== user?.privy_id) {
      log('[SignalListener] Request not for this user, ignoring')
      return
    }
    
    // Filter signals
    const signals = filterSignals(request)
    
    log('[SignalListener] Sending response:', signals.length, 'signals')
    
    // Send response to specific channel for this request
    const channelName = `signal_request_${request.request_id}`
    const responseChannel = supabaseRef.current.channel(channelName)
    
    await responseChannel.subscribe(async (status: string) => {
      if (status === 'SUBSCRIBED') {
        await responseChannel.send({
          type: 'broadcast',
          event: 'response',
          payload: {
            signals,
            count: signals.length,
            cached_at: new Date().toISOString()
          }
        })
        
        // Cleanup after sending
        setTimeout(() => {
          supabaseRef.current.removeChannel(responseChannel)
        }, 1000)
      }
    })
    
  }, [user?.privy_id, filterSignals])

  // Subscribe to signal requests
  useEffect(() => {
    if (!user?.privy_id || !isConnected) {
      log('[SignalListener] Not ready - missing user or SSE not connected')
      return
    }

    // Create Supabase client
    const supabase = getBrowserSupabaseClient()
    supabaseRef.current = supabase

    log('[SignalListener] Subscribing to signal_requests for user:', user.privy_id)

    // Subscribe to signal requests channel
    const channel = supabase
      .channel('signal_requests')
      .on('broadcast', { event: 'request' }, handleRequest)
      .subscribe((status) => {
        log('[SignalListener] Subscription status:', status)
      })

    return () => {
      log('[SignalListener] Unsubscribing')
      supabase.removeChannel(channel)
    }
  }, [user?.privy_id, isConnected, handleRequest])

  return {
    isListening: !!user?.privy_id && isConnected,
    signalCount: allTrades.length
  }
}
