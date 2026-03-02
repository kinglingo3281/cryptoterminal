/**
 * Bot API Types
 * Types for the external bot API that allows Moltbot/Clawdbot and other bots to connect
 */

import type { TradeSignal } from '@/hooks/useTradeDataManager'

// ============================================================================
// Token Types
// ============================================================================

export interface BotTokenPermissions {
  read_signals: boolean
  execute_trades: boolean
  read_account: boolean
  cancel_orders: boolean
  close_positions: boolean
}

export interface BotToken {
  id: string
  user_id: string
  token_hash: string
  label: string | null
  permissions: BotTokenPermissions
  created_at: string
  expires_at: string | null
  last_used_at: string | null
  is_revoked: boolean
}

export interface CreateTokenRequest {
  label?: string
  permissions?: Partial<BotTokenPermissions>
  expires_in_days?: number
}

export interface CreateTokenResponse {
  success: boolean
  token?: string  // Raw token - only shown once!
  token_id?: string
  error?: string
}

// ============================================================================
// API Request/Response Types
// ============================================================================

export interface BotApiError {
  success: false
  error: string
  code?: string
}

export interface BotApiSuccess<T> {
  success: true
  data: T
}

export type BotApiResponse<T> = BotApiSuccess<T> | BotApiError

// ============================================================================
// Signals
// ============================================================================

export interface SignalsResponse {
  signals: TradeSignal[]
  count: number
  total_cached?: number
  available_assets?: string[]
  cached_at: string
}

export interface SignalResponse {
  signal: TradeSignal
}

// ============================================================================
// Execute Trade
// ============================================================================

export interface ExecuteTradeRequest {
  // Option 1: Execute by signal ID
  signal_id?: string
  // Option 2: Execute by criteria (find matching signal)
  asset?: string
  direction?: 'long' | 'short'
  select?: 'newest' | 'highest_confidence' | 'best_rr'
  // Execution params
  position_size?: string  // "2.5%" | "$50" | "0.1"
  scale_up?: boolean
}

export interface ExecuteTradeResponse {
  order: {
    oid: string
    cloid?: string
    asset: string
    side: 'buy' | 'sell'
    size: number
    price: number
    notional: number
    leverage: number
  }
}

// ============================================================================
// Custom Order
// ============================================================================

export interface PlaceOrderRequest {
  asset: string
  side: 'buy' | 'sell'
  type: 'market' | 'limit'
  size: number
  price?: number
  leverage?: number
  reduce_only?: boolean
  tp_price?: number
  sl_price?: number
}

export interface PlaceOrderResponse {
  order: {
    oid: string
    cloid?: string
  }
}

// ============================================================================
// Positions
// ============================================================================

export interface BotPosition {
  asset: string
  size: number
  side: 'LONG' | 'SHORT'
  entry_price: number
  unrealized_pnl: number
  leverage: number
  liquidation_price?: number
  tp?: number | null
  sl?: number | null
}

export interface PositionsResponse {
  positions: BotPosition[]
}

// ============================================================================
// Orders
// ============================================================================

export interface BotOrder {
  oid: number
  asset: string
  side: string
  size: number
  price: number
  is_tpsl: boolean
  reduce_only: boolean
  cloid?: string | null
  timestamp?: number
}

export interface OrdersResponse {
  orders: BotOrder[]
}

// ============================================================================
// Account
// ============================================================================

export interface AccountResponse {
  account: {
    account_value: number
    available_balance: number
    margin_used: number
    unrealized_pnl: number
    cross_leverage: number
    withdrawable: number
  }
}

// ============================================================================
// Cancel Order
// ============================================================================

export interface CancelOrderRequest {
  order_id: string | number
  asset: string
}

export interface CancelOrderResponse {
  message: string
}

// ============================================================================
// Close Position
// ============================================================================

export interface ClosePositionRequest {
  asset: string
}

export interface ClosePositionResponse {
  message: string
}

// ============================================================================
// Token Management
// ============================================================================

export interface ListTokensResponse {
  tokens: Array<{
    id: string
    label: string | null
    permissions: BotTokenPermissions
    created_at: string
    expires_at: string | null
    last_used_at: string | null
    is_revoked: boolean
  }>
}

export interface RevokeTokenRequest {
  token_id: string
}

export interface RevokeTokenResponse {
  message: string
}

// ============================================================================
// Trade History
// ============================================================================

export interface BotFill {
  tid: number
  time: number
  asset: string
  side: 'BUY' | 'SELL'
  price: number
  size: number
  direction: string
  closed_pnl: number
  fee: number
  oid: number
}

export interface TradeHistoryResponse {
  fills: BotFill[]
  count: number
}

// ============================================================================
// Validated User from Token
// ============================================================================

export interface ValidatedBotUser {
  user_id: string
  token_id: string
  permissions: BotTokenPermissions
}

// ============================================================================
// New Bot Commands - Request/Response Types
// ============================================================================

export interface CancelAllRequest {
  asset?: string  // Optional filter
}

export interface CancelAllResponse {
  message: string
  cancelled: number
  total: number
  errors?: string[]
}

export interface CloseAllRequest {
  method: 'market' | 'limit'
  asset?: string  // Optional filter
}

export interface CloseAllResponse {
  message: string
  closed: number
  total: number
  method: string
  errors?: string[]
}

export interface StartChaseRequest {
  order_id: number | string
  asset: string
  tick_distance?: number
  percent_distance?: number
  frequency_min?: number
  frequency_max?: number
  range_price?: number
  range_type?: 'upper' | 'lower'
}

export interface StartChaseResponse {
  chase_id: string
  order_id: number | string
}

export interface StopChaseRequest {
  chase_id?: string
  asset?: string
}

export interface StopChaseResponse {
  message: string
  stopped?: number
}

export interface StartGridRequest {
  asset: string
  levels: 3 | 6 | 10
  base_tick_distance?: number
  base_percent_distance?: number
  size_per_level: number
  leverage?: number
  is_cross_margin?: boolean
  anchor?: number
  chase_frequency_min?: number
  chase_frequency_max?: number
}

export interface StartGridResponse {
  grid_id: string
  orders_placed: number
}

export interface StopGridRequest {
  grid_id: string
}

export interface StopGridResponse {
  message: string
}

export interface ModifyOrderRequest {
  order_id: number | string
  asset: string
  new_price: number
  new_size: number
  tp_price?: number
  tp_is_market?: boolean
  sl_price?: number
  sl_is_market?: boolean
}

export interface ModifyOrderResponse {
  message: string
}

export interface ModifyTPSLRequest {
  asset: string
  tp_price?: number
  tp_is_market?: boolean
  sl_price?: number
  sl_is_market?: boolean
}

export interface ModifyTPSLResponse {
  message: string
}
