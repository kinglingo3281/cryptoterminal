export interface TradeHistoryFill {
  // Core data (from API)
  tid: number;              // Unique trade ID (primary key)
  time: number;             // Timestamp in ms
  coin: string;             // Asset
  side: 'BUY' | 'SELL';    // Normalized from 'A'/'B'
  price: number;            // Parsed from string
  size: number;             // Parsed from string
  
  // Trade context
  direction: string;        // "Open Long", "Close Short", etc.
  closedPnl: number;       // Realized PnL
  
  // Fees
  fee: number;
  feeToken: string;
  builderFee?: number;
  
  // Position tracking
  startPosition: number;
  
  // Metadata
  oid: number;             // Order ID
  crossed: boolean;
  hash: string;
}

export interface TradeHistoryCache {
  version: number;          // Schema version for migrations
  fills: TradeHistoryFill[]; // Sorted newest → oldest
  lastCheckTimestamp: number; // When we last fetched
  newestFillTime: number | null; // Timestamp of most recent fill
  userAddress: string;      // Cache is per-user
}

export interface TradeHistoryStats {
  totalFills: number;
  totalVolume: number;
  totalFees: number;
  realizedPnl: number;
  dateRange: { start: number; end: number } | null;
}