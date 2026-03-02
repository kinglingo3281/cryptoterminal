/**
 * TrackerService - SSE connection for real-time Alpha Dashboard data
 */

import pako from 'pako'
import type { SymbolData } from '@/store/useTrackerStore'

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

interface TrackerServiceCallbacks {
  onStateChange?: (state: ConnectionState) => void
  onData?: (symbols: Map<string, SymbolData>) => void
  onError?: (error: string) => void
}

class TrackerService {
  private eventSource: EventSource | null = null
  private connectionState: ConnectionState = 'disconnected'
  private symbols: Map<string, SymbolData> = new Map()
  private callbacks: TrackerServiceCallbacks = {}
  
  // Connection config
  private sseUrl = process.env.NEXT_PUBLIC_TRACKER_URL || 'https://tracker.example.com:8443/sse/tracker'
  private walletAddress: string | null = null
  private reconnectAttempts = 0
  private maxReconnectDelay = 30000
  private reconnectDelay = 2000
  private reconnectTimeoutId: ReturnType<typeof setTimeout> | null = null
  private watchdogInterval: ReturnType<typeof setInterval> | null = null
  private watchdogTimeoutMs = 60000
  
  // Delta update tracking
  private lastSequence = 0
  private needsSnapshot = true
  private lastUpdate: Date | null = null
  private lastHeartbeat: Date | null = null
  
  // Payload limits
  private MAX_PAYLOAD_SIZE = 64 * 1024 * 1024 // 64MB

  // Upstash Redis polling (supplementary data source for evflow etc.)
  private upstashUrl = 'https://central-tetra-17219.upstash.io'
  private upstashToken = 'AkNDAAIgcDHwmNut9poQDiXquSunkOr9YWXx7lO4mtidAmeoEmgTdQ'
  private redisPollInterval: ReturnType<typeof setInterval> | null = null
  private REDIS_POLL_MS = 60000 // 60s, same as old codebase

  constructor() {
    this.setupVisibilityHandler()
    // Start Redis polling immediately for evflow + supplementary data
    this.startRedisPoll()
  }

  /**
   * Set callbacks for state changes and data updates
   */
  setCallbacks(callbacks: TrackerServiceCallbacks) {
    this.callbacks = callbacks
  }

  /**
   * Set wallet address for authentication
   */
  setWalletAddress(address: string) {
    if (this.isValidWalletAddress(address)) {
      this.walletAddress = address
      console.log('[TrackerService] Wallet address set')
    } else {
      console.error('[TrackerService] Invalid wallet address format')
    }
  }

  /**
   * Validate Ethereum wallet address
   */
  private isValidWalletAddress(address: string): boolean {
    return /^0x[a-fA-F0-9]{40}$/.test(address)
  }

  /**
   * Setup visibility change handler for tab focus reconnection
   */
  private setupVisibilityHandler() {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && this.connectionState !== 'disconnected') {
          const lastActivity = this.lastUpdate || this.lastHeartbeat
          if (lastActivity) {
            const timeSinceActivity = Date.now() - lastActivity.getTime()
            if (timeSinceActivity > 30000) {
              console.log('[TrackerService] Tab visible, connection stale, reconnecting...')
              this.reconnect()
            }
          }
        }
      })
    }
  }

  /**
   * Connect to SSE server
   */
  async connect(): Promise<void> {
    if (this.connectionState === 'connecting') {
      console.log('[TrackerService] Already connecting')
      return
    }

    if (!this.walletAddress) {
      this.setConnectionState('error')
      this.callbacks.onError?.('No wallet address set')
      return
    }

    this.setConnectionState('connecting')
    
    // Clear any pending reconnect
    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId)
      this.reconnectTimeoutId = null
    }

    // Close existing connection
    if (this.eventSource) {
      this.eventSource.close()
      this.eventSource = null
    }

    const url = `${this.sseUrl}?key=${this.walletAddress}`
    console.log('[TrackerService] Connecting to SSE...')

    try {
      const eventSource = new EventSource(url)
      this.eventSource = eventSource

      eventSource.onopen = () => {
        console.log('[TrackerService] SSE connected')
        this.setConnectionState('connected')
        this.reconnectAttempts = 0
        this.startWatchdog()
      }

      // Connection confirmation
      eventSource.addEventListener('connected', (event) => {
        try {
          const data = JSON.parse(event.data)
          console.log(`[TrackerService] Connection confirmed, client_id: ${data.client_id}`)
          this.lastHeartbeat = new Date()
        } catch (e) {
          console.warn('[TrackerService] Failed to parse connected event')
        }
      })

      // Heartbeat
      eventSource.addEventListener('heartbeat', () => {
        this.lastHeartbeat = new Date()
      })

      // Tracker data
      eventSource.addEventListener('tracker-data', (event) => {
        this.handleSSEMessage(event.data)
      })

      eventSource.onerror = () => {
        console.error('[TrackerService] SSE error')
        this.setConnectionState('error')
        this.callbacks.onError?.('SSE connection error')
        
        if (this.eventSource === eventSource) {
          eventSource.close()
          this.eventSource = null
        }
        
        this.scheduleReconnect()
      }

    } catch (error) {
      console.error('[TrackerService] Connection failed:', error)
      this.setConnectionState('error')
      this.callbacks.onError?.('Connection failed')
      this.scheduleReconnect()
    }
  }

  /**
   * Disconnect from SSE
   */
  disconnect() {
    this.stopWatchdog()
    
    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId)
      this.reconnectTimeoutId = null
    }
    
    if (this.redisPollInterval) {
      clearInterval(this.redisPollInterval)
      this.redisPollInterval = null
    }
    
    if (this.eventSource) {
      this.eventSource.close()
      this.eventSource = null
    }
    
    this.setConnectionState('disconnected')
    this.lastSequence = 0
    this.needsSnapshot = true
  }

  /**
   * Reconnect to SSE
   */
  async reconnect() {
    this.disconnect()
    await this.connect()
  }

  /**
   * Handle SSE message (GZIP compressed or raw JSON)
   */
  private handleSSEMessage(data: string) {
    try {
      if (data.length > this.MAX_PAYLOAD_SIZE) {
        console.error(`[TrackerService] Payload too large (${data.length} bytes)`)
        return
      }

      let parsed: any

      if (data.startsWith('GZIP:')) {
        const base64 = data.substring(5)
        const decompressed = this.decompressGzip(base64)
        if (!decompressed) return
        parsed = JSON.parse(decompressed)
      } else {
        parsed = JSON.parse(data)
      }

      // Check for delta format or legacy format
      if (parsed.type && parsed.seq !== undefined) {
        this.handleDeltaMessage(parsed)
      } else {
        this.handleLegacyMessage(parsed)
      }

    } catch (error) {
      console.warn('[TrackerService] SSE message parse failed:', error)
    }
  }

  /**
   * Decompress GZIP data from base64
   */
  private decompressGzip(base64Data: string): string | null {
    try {
      if (base64Data.length > this.MAX_PAYLOAD_SIZE) {
        console.error('[TrackerService] Compressed payload too large')
        return null
      }

      const binaryString = atob(base64Data)
      const bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }

      const decompressed = pako.ungzip(bytes, { to: 'string' })
      if (decompressed.length > this.MAX_PAYLOAD_SIZE) {
        console.error('[TrackerService] Decompressed payload too large')
        return null
      }
      return decompressed
    } catch (error) {
      console.error('[TrackerService] Decompression failed:', error)
      return null
    }
  }

  // Fields that come from Redis (computed server-side), not from SSE
  private static REDIS_FIELDS = ['evflow', 'flow_score', 'smart_dumb_cvd', 'cvd', 'perp_signals'] as const

  /**
   * Merge incoming SSE data with existing data, preserving Redis-sourced fields
   */
  private mergeSSEData(key: string, sseData: SymbolData) {
    const existing = this.symbols.get(key)
    if (!existing) {
      this.symbols.set(key, sseData)
      return
    }
    // SSE data is primary, but preserve Redis-sourced fields if SSE doesn't provide them
    const merged = { ...existing, ...sseData } as any
    for (const field of TrackerService.REDIS_FIELDS) {
      if (!(sseData as any)[field] && (existing as any)[field]) {
        merged[field] = (existing as any)[field]
      }
    }
    this.symbols.set(key, merged as SymbolData)
  }

  /**
   * Handle legacy message format (full data)
   */
  private handleLegacyMessage(allSymbols: Record<string, SymbolData>) {
    const symbolCount = Object.keys(allSymbols).length
    console.log(`[TrackerService] Received legacy message with ${symbolCount} symbols`)
    
    Object.entries(allSymbols).forEach(([symbol, symbolData]) => {
      this.mergeSSEData(symbol.toUpperCase(), symbolData)
    })

    this.needsSnapshot = false
    this.lastUpdate = new Date()
    this.notifyDataUpdate()
  }

  /**
   * Handle delta update format
   */
  private handleDeltaMessage(message: { type: string; seq: number; data?: Record<string, SymbolData>; removed?: string[] }) {
    const { type, seq, data, removed } = message

    // Guard against stale messages
    if (seq <= this.lastSequence && type !== 'snapshot') {
      return
    }

    if (type === 'snapshot') {
      // Preserve Redis-sourced fields from existing data before clearing
      const redisCache = new Map<string, Partial<SymbolData>>()
      this.symbols.forEach((existing, key) => {
        const cached: any = {}
        for (const field of TrackerService.REDIS_FIELDS) {
          if ((existing as any)[field]) cached[field] = (existing as any)[field]
        }
        if (Object.keys(cached).length > 0) redisCache.set(key, cached)
      })

      this.symbols.clear()
      if (data) {
        Object.entries(data).forEach(([symbol, symbolData]) => {
          const key = symbol.toUpperCase()
          // Restore Redis fields into new SSE data
          const cached = redisCache.get(key)
          if (cached) {
            const merged = { ...cached, ...symbolData } as SymbolData
            for (const field of TrackerService.REDIS_FIELDS) {
              if (!(symbolData as any)[field] && (cached as any)[field]) {
                (merged as any)[field] = (cached as any)[field]
              }
            }
            this.symbols.set(key, merged)
          } else {
            this.symbols.set(key, symbolData)
          }
        })
      }
      this.needsSnapshot = false
      this.lastSequence = seq

    } else if (type === 'delta') {
      if (data) {
        Object.entries(data).forEach(([symbol, symbolData]) => {
          this.mergeSSEData(symbol.toUpperCase(), symbolData)
        })
      }
      if (removed) {
        removed.forEach(symbol => this.symbols.delete(symbol.toUpperCase()))
      }
      this.lastSequence = seq
    }

    this.lastUpdate = new Date()
    this.notifyDataUpdate()
  }

  /**
   * Notify callbacks of data update
   */
  private notifyDataUpdate() {
    this.callbacks.onData?.(new Map(this.symbols))
  }

  /**
   * Start Upstash Redis polling (supplementary data for evflow, flow_score, etc.)
   * Same approach as V4-current tracker-service.js
   */
  private startRedisPoll() {
    // Fetch immediately
    this.loadFromRedis()
    // Then poll every 60s
    if (!this.redisPollInterval) {
      this.redisPollInterval = setInterval(() => this.loadFromRedis(), this.REDIS_POLL_MS)
    }
  }

  /**
   * Fetch tracker:all from Upstash Redis and merge into symbols map
   */
  private async loadFromRedis() {
    try {
      const response = await fetch(`${this.upstashUrl}/get/tracker:all`, {
        headers: { 'Authorization': `Bearer ${this.upstashToken}` }
      })

      if (!response.ok) return

      const data = await response.json()
      if (!data.result) return

      const allSymbols: Record<string, any> = JSON.parse(data.result)
      let merged = 0

      Object.entries(allSymbols).forEach(([symbol, redisData]) => {
        const key = symbol.toUpperCase()
        const existing = this.symbols.get(key)

        if (existing) {
          // SSE data takes priority for real-time fields, but Redis ALWAYS wins for computed fields
          const merged_data = { ...existing } as any
          // Always use Redis for computed fields (these are authoritative from Redis)
          for (const field of TrackerService.REDIS_FIELDS) {
            if ((redisData as any)[field]) merged_data[field] = (redisData as any)[field]
          }
          // Fill in any other missing fields from Redis
          for (const [k, v] of Object.entries(redisData as any)) {
            if (merged_data[k] === undefined || merged_data[k] === null) merged_data[k] = v
          }
          this.symbols.set(key, merged_data as SymbolData)
        } else {
          this.symbols.set(key, redisData as SymbolData)
          merged++
        }
      })

      console.log(`[TrackerService] Redis poll: ${Object.keys(allSymbols).length} symbols, ${merged} new`)

      if (!this.lastUpdate) this.lastUpdate = new Date()
      this.notifyDataUpdate()
    } catch (error) {
      // Silent fail — Redis is supplementary
    }
  }

  /**
   * Set connection state and notify
   */
  private setConnectionState(state: ConnectionState) {
    this.connectionState = state
    this.callbacks.onStateChange?.(state)
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnect() {
    if (this.connectionState === 'connecting') return

    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId)
    }

    this.reconnectAttempts++
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), this.maxReconnectDelay)
    console.log(`[TrackerService] Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts})`)

    this.reconnectTimeoutId = setTimeout(() => {
      this.reconnectTimeoutId = null
      if (this.connectionState !== 'connected') {
        this.connect().catch(console.error)
      }
    }, delay)
  }

  /**
   * Start watchdog timer
   */
  private startWatchdog() {
    this.stopWatchdog()
    
    this.watchdogInterval = setInterval(() => {
      const lastActivity = this.lastUpdate || this.lastHeartbeat
      if (!lastActivity) return

      const timeSinceActivity = Date.now() - lastActivity.getTime()
      if (timeSinceActivity > this.watchdogTimeoutMs) {
        console.warn(`[TrackerService] Watchdog: No activity for ${Math.round(timeSinceActivity / 1000)}s, reconnecting`)
        this.reconnect()
      }
    }, 30000)
  }

  /**
   * Stop watchdog timer
   */
  private stopWatchdog() {
    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval)
      this.watchdogInterval = null
    }
  }

  /**
   * Get symbol data
   */
  getSymbol(symbol: string): SymbolData | undefined {
    return this.symbols.get(symbol.toUpperCase())
  }

  /**
   * Get all symbols
   */
  getAllSymbols(): Map<string, SymbolData> {
    return new Map(this.symbols)
  }

  /**
   * Get connection state
   */
  getConnectionState(): ConnectionState {
    return this.connectionState
  }

  /**
   * Get time since last update
   */
  getTimeSinceUpdate(): string {
    if (!this.lastUpdate) return 'Waiting...'
    const seconds = Math.floor((Date.now() - this.lastUpdate.getTime()) / 1000)
    if (seconds < 60) return `${seconds}s ago`
    return `${Math.floor(seconds / 60)}m ago`
  }
}

// Singleton instance
export const trackerService = new TrackerService()
