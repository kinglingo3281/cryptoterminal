export interface SpotBalance {
  coin: string;
  token: number;
  total: number;
  hold: number;
}

// Spot tokens that map to perp prices
const SPOT_TO_PERP_MAP: Record<string, string> = {
  'UBTC': 'BTC',
  'UETH': 'ETH',
  'USOL': 'SOL'
};

export function calculateSpotEquity(
  balances: SpotBalance[],
  prices: Record<string, number>
): number {
  let totalEquity = 0;
  
  for (const balance of balances) {
    if (balance.total <= 0) continue;
    
    // Stablecoins are always $1 (USDC, USDH)
    if (balance.coin === 'USDC' || balance.coin === 'USDH') {
      totalEquity += balance.total * 1.0;
      continue;
    }
    
    // Try to find price for this token
    // 1. First try coin name directly (e.g., "HYPE", "BTC")
    let price = prices[balance.coin];
    
    // 2. Try mapped perp name for spot tokens (UBTC->BTC, etc.)
    if (!price) {
      const perpName = SPOT_TO_PERP_MAP[balance.coin];
      if (perpName) {
        price = prices[perpName];
      }
    }
    
    // 3. Fallback to @{token} format for other spot pairs
    if (!price && balance.token) {
      price = prices[`@${balance.token}`];
    }
    
    if (price && !isNaN(price)) {
      totalEquity += balance.total * price;
    }
  }
  
  return totalEquity;
}
