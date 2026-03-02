/**
 * Bot Command Types
 * Commands sent from Clawdbot to browser via Supabase Realtime
 */

export type BotCommandType = 
  | 'execute' 
  | 'order' 
  | 'cancel' 
  | 'close'
  | 'cancel_all'
  | 'close_all'
  | 'start_chase'
  | 'stop_chase'
  | 'stop_all_chases'
  | 'start_grid'
  | 'stop_grid'
  | 'modify_order'
  | 'modify_tpsl'
  | 'get_chases'
  | 'get_grids'
  | 'chase_order'
  | 'get_alpha_data'
  | 'get_signal_details'
  | 'get_funding_pairs'
  | 'get_atr'
  | 'get_symbols'
  // Bot Control Commands
  | 'bot_start'
  | 'bot_stop'
  | 'bot_status'
  // Settings Commands
  | 'get_autotrade_settings'
  | 'set_autotrade_mode'
  | 'set_position_size'
  | 'set_advanced_filters'
  | 'set_blacklist'
  // Logs Commands
  | 'get_logs'

export interface BotCommand {
  id: string
  user_id: string
  command_type: BotCommandType
  payload: BotCommandPayload
  status: 'pending' | 'received' | 'executed' | 'failed'
  result?: any
  created_at: string
  executed_at?: string
}

export type BotCommandPayload = 
  | ExecuteCommandPayload 
  | OrderCommandPayload 
  | CancelCommandPayload 
  | CloseCommandPayload
  | CancelAllCommandPayload
  | CloseAllCommandPayload
  | StartChaseCommandPayload
  | StopChaseCommandPayload
  | StopAllChasesCommandPayload
  | StartGridCommandPayload
  | StopGridCommandPayload
  | ModifyOrderCommandPayload
  | ModifyTPSLCommandPayload
  | GetChasesCommandPayload
  | GetGridsCommandPayload
  | ChaseOrderCommandPayload
  | GetAlphaDataCommandPayload
  | GetSignalDetailsCommandPayload
  | GetFundingPairsCommandPayload
  | GetAtrCommandPayload
  | GetSymbolsCommandPayload
  // Bot Control Payloads
  | BotStartCommandPayload
  | BotStopCommandPayload
  | BotStatusCommandPayload
  // Settings Payloads
  | GetAutotradeSettingsPayload
  | SetAutotradeModePayload
  | SetPositionSizePayload
  | SetAdvancedFiltersPayload
  | SetBlacklistPayload
  // Logs Payloads
  | GetLogsPayload

export interface ExecuteCommandPayload {
  // Option 1: Execute by signal ID
  signal_id?: string
  // Option 2: Execute by criteria (find matching signal)
  asset?: string
  direction?: 'long' | 'short'
  // Execution params
  position_size?: string
  scale_up?: boolean
  // Signal selection criteria (when not using signal_id)
  select?: 'newest' | 'highest_confidence' | 'best_rr'
}

export interface OrderCommandPayload {
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

export interface CancelCommandPayload {
  order_id: string | number
  asset: string
}

export interface CloseCommandPayload {
  asset: string
}

export interface CommandResult {
  success: boolean
  data?: any
  error?: string
}

// ============================================================================
// New Command Payloads
// ============================================================================

export interface CancelAllCommandPayload {
  asset?: string  // Optional: filter by asset, or cancel ALL if omitted
}

export interface CloseAllCommandPayload {
  method: 'market' | 'limit'  // market = 10% slippage, limit = progressive slippage
  asset?: string  // Optional: filter by asset, or close ALL if omitted
}

export interface StartChaseCommandPayload {
  order_id: number | string
  asset: string
  tick_distance?: number      // Use ticks (mutually exclusive with percent_distance)
  percent_distance?: number   // Use percent (mutually exclusive with tick_distance)
  frequency_min?: number      // Seconds between modifications (default: 5, range: 5-60)
  frequency_max?: number      // Seconds between modifications (default: 15, range: 5-60)
  range_price?: number        // Optional price limit - stop chase if crossed
  range_type?: 'upper' | 'lower'  // Direction for range_price
  anchor_price?: number       // Optional anchor price for EV calculation
  use_anchor?: boolean        // Use anchor price mode
  aggressive?: boolean        // Cross spread for faster fills (default: false)
}

export interface StopChaseCommandPayload {
  chase_id?: string   // Stop specific chase
  asset?: string      // OR stop all chases for asset
}

export interface StopAllChasesCommandPayload {
  // Empty - stops all active chases
}

export interface StartGridCommandPayload {
  asset: string
  levels: 3 | 6 | 10
  base_tick_distance?: number     // Use ticks (mutually exclusive with percent)
  base_percent_distance?: number  // Use percent (mutually exclusive with ticks)
  size_per_level: number
  leverage?: number
  is_cross_margin?: boolean
  anchor?: number  // Optional anchor price
  chase_frequency_min?: number
  chase_frequency_max?: number
}

export interface StopGridCommandPayload {
  grid_id: string
}

export interface ModifyOrderCommandPayload {
  order_id: number | string
  asset: string
  new_price: number
  new_size: number
  tp_price?: number
  tp_is_market?: boolean
  sl_price?: number
  sl_is_market?: boolean
}

export interface ModifyTPSLCommandPayload {
  asset: string
  tp_price?: number
  tp_is_market?: boolean
  sl_price?: number
  sl_is_market?: boolean
}

export interface GetChasesCommandPayload {
  asset?: string       // Optional: filter by asset
  chase_id?: string    // Optional: get specific chase
}

export interface GetGridsCommandPayload {
  asset?: string       // Optional: filter by asset
  grid_id?: string     // Optional: get specific grid
}

export interface ChaseOrderCommandPayload {
  // Order params
  asset: string
  side: 'buy' | 'sell'
  size: number
  price: number
  leverage?: number
  // Chase params
  tick_distance?: number
  percent_distance?: number
  frequency_min?: number
  frequency_max?: number
  range_price?: number
  range_type?: 'upper' | 'lower'
  aggressive?: boolean
}

// ============================================================================
// Alpha Dashboard & Analytics Command Payloads
// ============================================================================

export interface GetAlphaDataCommandPayload {
  symbol: string    // Required: asset symbol (BTC, ETH, etc.)
}

export interface GetSignalDetailsCommandPayload {
  signal_id: string // Required: specific signal ID to get details for
}

export interface GetFundingPairsCommandPayload {
  limit?: number           // Optional: max pairs to return (default 30)
  min_spread?: number      // Optional: min spread % to filter
  min_strength?: number    // Optional: min signal strength (1-4)
}

export interface GetAtrCommandPayload {
  asset: string            // Required: asset symbol
  timeframe?: string       // Optional: 1m, 5m, 15m, 1h, 4h (default 15m)
}

export interface GetSymbolsCommandPayload {
  // No params - returns all available symbols with data
}

// ============================================================================
// Bot Control Command Payloads
// ============================================================================

export type BotType = 'autotrade' | 'cancel' | 'sltp' | 'trailing' | 'mm'

export interface BotStartCommandPayload {
  bot: BotType | 'all'
}

export interface BotStopCommandPayload {
  bot: BotType | 'all'
}

export interface BotStatusCommandPayload {
  // No params - returns status of all bots
}

// ============================================================================
// Settings Command Payloads
// ============================================================================

export interface GetAutotradeSettingsPayload {
  // No params - returns all autotrade settings
}

export interface SetAutotradeModePayload {
  mode: 'volume' | 'advanced'
  risk_level?: 1 | 2 | 3 | 4 | 5  // Only used in volume mode
}

export interface SetPositionSizePayload {
  size: string  // '2.5%' | '$50' | '0.1'
}

export interface SetAdvancedFiltersPayload {
  // All fields optional - only provided values are updated
  confidence_enabled?: boolean
  min_confidence?: number
  rr_enabled?: boolean
  min_rr?: number
  max_rr?: number
  tp_distance_enabled?: boolean
  min_tp_distance?: number
  max_tp_distance?: number
  sl_distance_enabled?: boolean
  min_sl_distance?: number
  max_sl_distance?: number
  entry_distance_enabled?: boolean
  min_entry_distance?: number
  max_entry_distance?: number
  max_longs?: number
  max_shorts?: number
  long_bias_enabled?: boolean
  short_bias_enabled?: boolean
  long_bias?: number
  short_bias?: number
  ranging_enabled?: boolean
  liquidity_enabled?: boolean
  enhanced_enabled?: boolean
  v3_enabled?: boolean
  scale_up_size?: boolean
  order_layering?: boolean
  cross_order?: boolean
}

export interface SetBlacklistPayload {
  action: 'add' | 'remove' | 'set' | 'clear'
  assets?: string[]  // Required for add/remove/set
}

// ============================================================================
// Logs Command Payloads
// ============================================================================

export interface GetLogsPayload {
  bot?: BotType | 'system'  // Filter by bot type
  type?: 'info' | 'success' | 'error' | 'warning' | 'trade'  // Filter by log type
  limit?: number  // Max logs to return (default 50)
  search?: string  // Search in message text
}
