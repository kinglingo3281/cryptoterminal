import type { ChaseSettings } from './chase'

export interface GridConfig {
  asset: string
  levels: 3 | 6 | 10
  baseTickDistance: number
  basePercentDistance?: number
  isPercent: boolean
  sizePerLevel: number
  anchor?: number
  useAnchor: boolean
  frequency: number
  chaseSettings: ChaseSettings
  leverage: number
  isCrossMargin: boolean
}

export interface GridState {
  gridId: string
  asset: string
  levels: number
  baseTickDistance: number
  basePercentDistance?: number
  isPercent: boolean
  sizePerLevel: number
  anchor?: number
  chaseSettings: ChaseSettings
  orders: GridOrder[]
  status: 'active' | 'stopping' | 'stopped'
  startTime: number
}

export interface GridOrder {
  side: 'buy' | 'sell'
  level: number
  tickDistance?: number
  percentDistance?: number
  isPercent: boolean
  oid: string
  price: number
  chaseId: string
  status: 'active' | 'filled' | 'cancelled'
}

export interface GridResult {
  success: boolean
  gridId?: string
  ordersPlaced?: number
  error?: string
}
