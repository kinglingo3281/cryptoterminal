export interface Position {
  coin: string;
  size: number;
  entryPrice: number;
  unrealizedPnl: number;
  side: 'LONG' | 'SHORT';
  leverage?: number;
  liquidationPrice?: number;
  tp?: number | null;
  sl?: number | null;
  dex: string;
  isHip3: boolean;
}

export interface Order {
  oid: number;
  coin: string;
  side: 'BUY' | 'SELL' | 'LONG' | 'SHORT';
  size: number;
  limitPx: number;
  isPositionTpsl: boolean;
  reduceOnly: boolean;
  cloid?: string | null;
  timestamp?: number;
  orderType?: string;
  dex: string;
  isHip3: boolean;
}

export interface SpotBalance {
  coin: string;
  token: number;
  total: number;
  hold: number;
}

export interface AccountSummary {
  accountValue: number;
  totalRawUsd: number;
  withdrawable: number;
  marginUsed: number;
  totalNtlPos: number;
  usdhBalance?: number;
  spotBalance: number;
  perpsBalance: number;
  totalUnrealizedPnl: number;
  crossMarginRatio: number;
  maintenanceMargin: number;
  crossAccountLeverage: number;
  spotBalances: SpotBalance[];
  availableForTrading: number;
}

export interface PositionsUpdatePayload {
  type: 'positions-update';
  positions: Position[];
  orders: Order[];
  accountSummary: AccountSummary;
  timestamp: number;
  connected: boolean;
}
