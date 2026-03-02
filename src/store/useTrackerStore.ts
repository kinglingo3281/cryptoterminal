import { create } from 'zustand'
import { trackerService } from '@/services/TrackerService'

// Symbol data structure from tracker SSE
export interface EVFlowData {
  available: boolean
  score: number
  signal: string
  confidence: number
  aligned: boolean
  diverging: boolean
  divergence_warning?: string
  components: {
    evscore: number
    cvd: number
    qim: number
  }
}

export interface SmartDumbCVD {
  divergence_signal: string
  combined_score: number
  labeled_cvd_pct: number
  divergence_z: number
  smart_cvd_pct: number
  dumb_cvd_pct: number
  smart_cvd: number
  dumb_cvd: number
  smart_volume: number
  dumb_volume: number
  total_volume: number
  trade_count: number
  significance: string
  warm: boolean
}

export interface FlowScore {
  available: boolean
  score: number
  signal: string
  confidence: number
  tier: string
  inputs: {
    spot_5m: string
    spot_15m: string
    perp_5m: string
    perp_15m: string
    oi: string
    price: string
  }
}

export interface MultiExchangeCVD {
  spot?: {
    '5m'?: { value: number }
    breakdown?: Record<string, { value: number; signal: string }>
  }
  perp?: {
    '5m'?: { value: number }
    breakdown?: Record<string, { value: number; signal: string }>
  }
}

export interface LiquidationLevel {
  price: number
  total_value: number
  total_pnl: number
  concentration: string
  top1_pct?: number
  top_wallets: Array<{
    addr: string
    value: number
    entry: number
    liq: number
    margin_mode: string
    balance: number
    label: string
    pnl_cohort: string
    size_cohort: string
    holding_time: number
    pnl: number
    stress?: number
    effective_leverage?: number
    net_exposure?: number
    num_symbols?: number
  }>
}

export interface LiquidationHeatmap {
  long_liquidations: LiquidationLevel[]
  short_liquidations: LiquidationLevel[]
  most_huntable_long?: { price: number; huntability: number; value: number }
  most_huntable_short?: { price: number; huntability: number; value: number }
  long_total_pnl?: number
  short_total_pnl?: number
  smart_long_pnl?: number
  smart_short_pnl?: number
  dumb_long_pnl?: number
  dumb_short_pnl?: number
  smart_count?: number
  dumb_count?: number
}

export interface OrderbookHeatmap {
  bids: Array<{ price: number; size: number; total: number }>
  asks: Array<{ price: number; size: number; total: number }>
  spread: number
  spread_pct: number
  imbalance: number
  imbalance_pct: number
  bid_depth: number
  ask_depth: number
  updated_at?: string
}

export interface PositionAlerts {
  signal: string
  alert_count: number
  smart_long: number
  smart_short: number
  dumb_long: number
  dumb_short: number
  alerts?: Array<{
    wallet: string
    symbol: string
    side: string
    size: number
    entry: number
    liq: number
    label: string
    type?: string
    balance?: number
    pnl?: number
    margin_mode?: string
    holding_time?: number
    age?: number
    leverage?: number
  }>
}

export interface FragileWallet {
  wallet: string
  symbol: string
  side: string
  size: number
  entry: number
  liq: number
  pnl: number
  leverage: number
  balance: number
  label: string
  holding_time: number
  stress: number
}

export interface FragileWallets {
  wallets: FragileWallet[]
  count: number
  high_sensitivity_count: number
}

// Perp Signal (OFM, FADE, LIQ_PNL, CVD)
export interface PerpSignal {
  signal: string
  z_score?: number
  z_smart?: number
  z_dumb?: number
  explanation?: string
  confidence?: number
}

export interface PerpSignals {
  ofm?: PerpSignal
  fade?: PerpSignal
  liq_pnl?: PerpSignal
  cvd?: PerpSignal
}

// Breakdown data by skill/cohort/equity
export interface BreakdownEntry {
  long_usd: number
  short_usd: number
  net_usd: number
  in_danger_pct: number
  // Alternative fields from API (cohort/size tables use these)
  long_count?: number
  short_count?: number
  count?: number
  total_value?: number
  net_bias?: number
  net_direction?: string
  avg_leverage?: number
  avg_score?: number
  top_wallets?: Array<{
    wallet: string
    label: string
    cohort: string
    size_cohort: string
    side: string
    size: number
    entry: number
    liq: number
    pnl: number
    holding_time: number
    balance: number
    margin_mode: string
  }>
}

export interface BreakdownData {
  by_label?: Record<string, BreakdownEntry>
  by_cohort?: Record<string, BreakdownEntry>
  by_size?: Record<string, BreakdownEntry>
  by_label_all?: Record<string, BreakdownEntry>
  by_cohort_all?: Record<string, BreakdownEntry>
  by_size_all?: Record<string, BreakdownEntry>
  hot_zone_pct?: number
  total_positions?: number
  filtered_positions?: number
  avg_leverage?: number
  coverage_pct?: number
}

// Order Flow Metrics (OFM) data
export interface OFMData {
  flow_signal?: string
  smart_flow?: string
  smart_flow_value?: number
  conviction_score?: number
  net_long_flow?: number
  net_short_flow?: number
  cycle_time?: number
  new_longs?: number
  new_shorts?: number
  closed_longs?: number
  closed_shorts?: number
  flipped_to_long?: number
  flipped_to_short?: number
  new_longs_usd?: number
  new_shorts_usd?: number
  closed_longs_usd?: number
  closed_shorts_usd?: number
  // Aggregated timeframes
  new_longs_15m?: number
  new_shorts_15m?: number
  new_longs_1h?: number
  new_shorts_1h?: number
  new_longs_4h?: number
  new_shorts_4h?: number
  new_longs_24h?: number
  new_shorts_24h?: number
}

export interface SymbolData {
  price: number | { mark?: number; current?: number }
  price_change?: {
    pct_24h: number
    prev_day_px: number
    volume_24h?: number
  }
  evflow?: EVFlowData
  ofm?: OFMData
  cvd?: {
    multi_exchange?: MultiExchangeCVD
    hl_cvd_5m?: number
    binance_cvd_5m?: number
    hl_weight?: number
    cvd_divergence?: boolean
    cvd_divergence_type?: string
  }
  smart_dumb_cvd?: SmartDumbCVD
  flow_score?: FlowScore
  liquidation_heatmap?: LiquidationHeatmap
  orderbook_heatmap?: OrderbookHeatmap
  orderbook_heatmap_all?: OrderbookHeatmap
  position_alerts?: PositionAlerts
  fragile_wallets?: FragileWallets
  funding?: { rate: number; predicted: number }
  signals?: { follow_fade: string; confidence: number }
  generated_at?: string
  // New: Perp signals for strong signal banner
  perp_signals?: PerpSignals
  // New: Breakdown data for skill/cohort/equity tables
  breakdown?: BreakdownData
  // Alternative breakdown data at root level (as sent by tracker)
  by_label?: Record<string, BreakdownEntry>
  by_cohort?: Record<string, BreakdownEntry>
  by_size?: Record<string, BreakdownEntry>
  // All-zone (unfiltered) breakdown data at root level
  by_label_all?: Record<string, BreakdownEntry>
  by_cohort_all?: Record<string, BreakdownEntry>
  by_size_all?: Record<string, BreakdownEntry>
  // Summary data
  summary?: {
    hot_zone_pct?: number
    total_positions?: number
    filtered_positions?: number
  }
}

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

interface TrackerStore {
  // Connection state
  connectionState: ConnectionState
  error: string | null
  lastUpdate: Date | null
  
  // Symbol data
  symbols: Map<string, SymbolData>
  selectedSymbol: string
  
  // UI state
  activePanel: 'evflow' | 'hunter'
  zoneMode: 'hot' | 'all'
  totalsMode: 'all' | 'smart' | 'dumb'
  liqHeatmapExpanded: boolean
  obHeatmapExpanded: boolean
  
  // Actions
  setConnectionState: (state: ConnectionState) => void
  setError: (error: string | null) => void
  setLastUpdate: (date: Date) => void
  setSymbols: (symbols: Map<string, SymbolData>) => void
  updateSymbol: (symbol: string, data: SymbolData) => void
  setSelectedSymbol: (symbol: string) => void
  setActivePanel: (panel: 'evflow' | 'hunter') => void
  setZoneMode: (mode: 'hot' | 'all') => void
  setTotalsMode: (mode: 'all' | 'smart' | 'dumb') => void
  toggleLiqHeatmapExpanded: () => void
  toggleObHeatmapExpanded: () => void
  getSymbolData: (symbol: string) => SymbolData | undefined
  getSymbolList: () => string[]
  
  // Bot-callable actions
  connectTracker: (walletAddress: string) => Promise<boolean>
  isConnected: () => boolean
  clearStaleData: () => void
  reset: () => void
}

// Helper to safely read from localStorage
const getStoredValue = <T>(key: string, defaultValue: T): T => {
  if (typeof window === 'undefined') return defaultValue
  try {
    const stored = localStorage.getItem(key)
    return stored ? (stored as unknown as T) : defaultValue
  } catch {
    return defaultValue
  }
}

export const useTrackerStore = create<TrackerStore>((set, get) => ({
  // Initial state - restore from localStorage where applicable
  connectionState: 'disconnected',
  error: null,
  lastUpdate: null,
  symbols: new Map(),
  selectedSymbol: 'BTC',
  activePanel: 'evflow',
  zoneMode: (typeof window !== 'undefined' ? localStorage.getItem('trackerZoneMode') as 'hot' | 'all' : null) || 'hot',
  totalsMode: (typeof window !== 'undefined' ? localStorage.getItem('trackerTotalsMode') as 'all' | 'smart' | 'dumb' : null) || 'all',
  liqHeatmapExpanded: false,
  obHeatmapExpanded: false,
  
  // Actions
  setConnectionState: (connectionState) => set({ connectionState }),
  setError: (error) => set({ error }),
  setLastUpdate: (lastUpdate) => set({ lastUpdate }),
  
  setSymbols: (symbols) => set({ symbols: new Map(symbols) }),
  
  updateSymbol: (symbol, data) => set((state) => {
    const newSymbols = new Map(state.symbols)
    newSymbols.set(symbol.toUpperCase(), data)
    return { symbols: newSymbols }
  }),
  
  setSelectedSymbol: (selectedSymbol) => set({ selectedSymbol: selectedSymbol.toUpperCase() }),
  setActivePanel: (activePanel) => set({ activePanel }),
  setZoneMode: (zoneMode) => {
    if (typeof window !== 'undefined') localStorage.setItem('trackerZoneMode', zoneMode)
    set({ zoneMode })
  },
  setTotalsMode: (totalsMode) => {
    if (typeof window !== 'undefined') localStorage.setItem('trackerTotalsMode', totalsMode)
    set({ totalsMode })
  },
  toggleLiqHeatmapExpanded: () => set((state) => ({ liqHeatmapExpanded: !state.liqHeatmapExpanded })),
  toggleObHeatmapExpanded: () => set((state) => ({ obHeatmapExpanded: !state.obHeatmapExpanded })),
  
  getSymbolData: (symbol) => get().symbols.get(symbol.toUpperCase()),
  getSymbolList: () => Array.from(get().symbols.keys()).sort(),
  
  // Bot-callable: Connect to tracker SSE
  connectTracker: async (walletAddress: string) => {
    const state = get()
    
    // Already connected or connecting
    if (state.connectionState === 'connected') {
      console.log('[TrackerStore] Already connected')
      return true
    }
    
    if (state.connectionState === 'connecting') {
      console.log('[TrackerStore] Already connecting, waiting...')
      // Wait for connection (poll every 200ms for up to 10s)
      for (let i = 0; i < 50; i++) {
        await new Promise(resolve => setTimeout(resolve, 200))
        const current = get()
        if (current.connectionState === 'connected' && current.symbols.size > 0) {
          return true
        }
        if (current.connectionState === 'error') {
          return false
        }
      }
      return get().connectionState === 'connected'
    }
    
    // Set up callbacks
    trackerService.setCallbacks({
      onStateChange: (newState) => {
        set({ connectionState: newState })
      },
      onData: (data) => {
        set({ symbols: new Map(data), lastUpdate: new Date() })
      },
      onError: (error) => {
        set({ error })
      }
    })
    
    // Connect
    console.log('[TrackerStore] Bot triggered tracker connection...')
    trackerService.setWalletAddress(walletAddress)
    
    try {
      await trackerService.connect()
      
      // Wait for data to arrive (poll every 200ms for up to 10s)
      for (let i = 0; i < 50; i++) {
        await new Promise(resolve => setTimeout(resolve, 200))
        const current = get()
        if (current.symbols.size > 0) {
          console.log(`[TrackerStore] Connected with ${current.symbols.size} symbols`)
          return true
        }
      }
      
      // Connected but no data yet
      return get().connectionState === 'connected'
    } catch (error) {
      console.error('[TrackerStore] Connection error:', error)
      return false
    }
  },
  
  isConnected: () => {
    const state = get()
    return state.connectionState === 'connected' && state.symbols.size > 0
  },
  
  // Clear data older than 10 minutes
  clearStaleData: () => {
    const state = get()
    if (state.lastUpdate) {
      const age = Date.now() - state.lastUpdate.getTime()
      if (age > 10 * 60 * 1000) {
        console.log('[TrackerStore] Clearing stale data')
        set({ symbols: new Map(), lastUpdate: null })
      }
    }
  },
  
  // Full reset
  reset: () => {
    trackerService.disconnect()
    set({
      connectionState: 'disconnected',
      error: null,
      lastUpdate: null,
      symbols: new Map(),
      selectedSymbol: 'BTC'
    })
  }
}))
