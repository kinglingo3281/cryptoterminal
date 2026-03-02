export interface ChaseSettings {
  // Distance mode
  tickDistance?: number      // e.g., 10 ticks
  percentDistance?: number   // e.g., 0.5 (means 0.5%)
  isPercent: boolean
  
  // Frequency (seconds)
  frequencyRangeMin: number  // e.g., 10
  frequencyRangeMax: number  // e.g., 20
  
  // Optional constraints
  rangePrice?: number | null        // Stop chase if price crosses
  rangeType?: 'upper' | 'lower' | null
  anchorPrice?: number | null       // EV Grid anchor (future feature)
  useAnchor: boolean
  
  // TP/SL automation
  tpslEnabled?: boolean
  tpAtrMultiple?: number
  slAtrMultiple?: number
  tpPrice?: number | null    // Fixed TP price (from UI or Strong Signal)
  slPrice?: number | null    // Fixed SL price (from UI or Strong Signal)
  tpIsLimit?: boolean        // true = limit order, false = market order for TP
  slIsLimit?: boolean        // true = limit order, false = market order for SL
  
  // Order behavior
  aggressive?: boolean  // Cross spread for faster fills
  gracePeriodMs?: number  // Override default 30s grace period before first modification
}

export interface ChaseData {
  // Identifiers
  chaseId: string           // 'chase-{oid}-{timestamp}'
  originalOid: string
  currentOid: string        // Updates on each modification
  oidHistory: string[]      // Last 5 OIDs
  
  // Asset info
  asset: string
  side: 'B' | 'A'          // API format
  direction: 'LONG' | 'SHORT'
  
  // Size tracking
  size: number
  originalSize: number
  sizeHistory: number[]     // For partial fills
  
  // Price tracking
  originalPrice: number
  currentPrice: number
  priceHistory: number[]    // Last 5 prices
  
  // Order config
  reduceOnly: boolean
  
  // Chase config
  settings: ChaseSettings
  
  // Status
  status: 'active' | 'stopped'
  startTime: number
  endTime?: number
  endReason?: string        // 'order_filled' | 'user_stopped' | 'price_limit_reached'
  
  // Tracking
  lastModification: number | null
  modificationCount: number
  tickSize?: number         // Calculated from orderbook
  nextCheckTime?: number    // When to check next
  
  // Current orderbook analysis
  currentTicksAway?: number // Distance from best price in ticks
  currentBestPrice?: number // Current best bid/ask
  
  // State flags
  isModifying: boolean      // Mutex during modification
  missingCount: number      // Poll counter for fill detection
  _tpslPlaced?: boolean     // Prevent duplicate TP/SL
  
  // Fill events
  fillEvents: Array<{
    timestamp: number
    filled: number
    remaining: number
  }>
  
  // Cancelled TP/SL at start
  cancelledTpSl: any[]
}

export interface OrderAnalysis {
  position: number    // Queue position (1 = best)
  ticksAway: number   // Distance from best price in ticks
  bestPrice: number   // Best bid (buy) or ask (sell)
  isValid: boolean
}

export interface OrderbookData {
  asset: string
  bids: [number, number][]    // [price, size]
  asks: [number, number][]
  bestBid: number
  bestAsk: number
  timestamp: number
}

export type ChaseListener = (data: OrderbookData) => void
