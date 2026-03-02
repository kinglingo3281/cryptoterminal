export interface FundingAsset {
  symbol: string
  rate_1h: number
  rate_1h_pct: number
  volume_24h: number
}

export interface FundingPair {
  long_symbol: string
  short_symbol: string
  long_rate_1h_pct: number
  short_rate_1h_pct: number
  spread_1h_pct: number
  annualized_pct: number
  signal_strength: 1 | 2 | 3 | 4
}

export interface FundingPairHistory {
  id: string
  longSymbol: string
  shortSymbol: string
  longRate: number
  shortRate: number
  spread: number
  spreadAnnualized: number
  signalStrength: number
  longPosition: {
    actualSymbol: string
    size: number
    entryPrice: number
    direction: 'LONG'
  }
  shortPosition: {
    actualSymbol: string
    size: number
    entryPrice: number
    direction: 'SHORT'
  }
  tradeSize: number
  openedAt: number
  status: 'ACTIVE' | 'CLOSED'
  lastVerified: number
  verificationAttempts: number
  closedAt: number | null
}

export interface FundingPairHistoryStore {
  version: number
  pairs: FundingPairHistory[]
}
