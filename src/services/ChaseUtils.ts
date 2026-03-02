import type { Order } from '@/types/positions'

export class ChaseUtils {
  /**
   * Convert side formats between different representations
   */
  static convertSide(
    side: string,
    format: 'direction' | 'side_api' | 'side_sdk'
  ): string {
    const normalized = side.toUpperCase()
    
    if (format === 'direction') {
      // Convert to LONG/SHORT
      if (normalized === 'B' || normalized === 'BUY') return 'LONG'
      if (normalized === 'A' || normalized === 'SELL') return 'SHORT'
      return normalized
    }
    
    if (format === 'side_api') {
      // Convert to B/A (API format)
      if (normalized === 'BUY' || normalized === 'LONG') return 'B'
      if (normalized === 'SELL' || normalized === 'SHORT') return 'A'
      return normalized
    }
    
    if (format === 'side_sdk') {
      // Convert to buy/sell (SDK format)
      if (normalized === 'B' || normalized === 'LONG') return 'buy'
      if (normalized === 'A' || normalized === 'SHORT') return 'sell'
      return normalized.toLowerCase()
    }
    
    return side
  }

  /**
   * Extract order ID from various response formats
   */
  static extractOrderId(result: any): string | null {
    if (!result) return null
    
    // NEW: Direct OID field (now returned from HyperliquidOrderClient)
    if (result.oid) return String(result.oid)
    
    // Legacy paths
    if (result.orderId) return String(result.orderId)
    
    // Try nested response structure (resting = limit order, filled = immediate fill)
    if (result.response?.data?.statuses?.[0]?.resting?.oid) {
      return String(result.response.data.statuses[0].resting.oid)
    }
    
    if (result.response?.data?.statuses?.[0]?.filled?.oid) {
      return String(result.response.data.statuses[0].filled.oid)
    }
    
    if (result.response?.data?.statuses?.[0]?.oid) {
      return String(result.response.data.statuses[0].oid)
    }
    
    if (result.data?.oid) return String(result.data.oid)
    
    console.warn('[ChaseUtils] Could not extract OID from result:', result)
    return null
  }

  /**
   * Match an order from a list based on chase criteria
   */
  static matchOrder(
    chase: { asset: string; size: number; side: string; oidHistory: string[] },
    orders: Order[]
  ): Order | null {
    // Filter to asset orders
    const assetOrders = orders.filter(o => o.coin === chase.asset)
    if (assetOrders.length === 0) return null
    
    // Primary: OID history match (most reliable)
    const oidMatch = assetOrders.find(o => 
      chase.oidHistory.includes(String(o.oid))
    )
    if (oidMatch) return oidMatch

    // Fallback: exact size + side match
    const exactMatch = assetOrders.find(o => {
      const orderSize = o.size
      const orderSide = o.side.toUpperCase()
      const chaseSide = chase.side.toUpperCase()
      
      // Check if sides match (handle both B/A and BUY/SELL formats)
      const sidesMatch = 
        orderSide === chaseSide ||
        (orderSide === 'BUY' && (chaseSide === 'B' || chaseSide === 'BUY')) ||
        (orderSide === 'LONG' && (chaseSide === 'B' || chaseSide === 'BUY' || chaseSide === 'LONG')) ||
        (orderSide === 'B' && (chaseSide === 'BUY' || chaseSide === 'B' || chaseSide === 'LONG')) ||
        (orderSide === 'SELL' && (chaseSide === 'A' || chaseSide === 'SELL')) ||
        (orderSide === 'SHORT' && (chaseSide === 'A' || chaseSide === 'SELL' || chaseSide === 'SHORT')) ||
        (orderSide === 'A' && (chaseSide === 'SELL' || chaseSide === 'A' || chaseSide === 'SHORT'))
      
      return Math.abs(orderSize - chase.size) < 0.0001 && sidesMatch
    })
    
    return exactMatch || null
  }

  /**
   * Calculate tick size from orderbook
   */
  static calculateTickSize(bids: [number, number][], asks: [number, number][]): number {
    if (bids.length < 2) return 0.01
    
    // Calculate from bid price differences
    const priceDiff = Math.abs(bids[0][0] - bids[1][0])
    if (priceDiff > 0) return priceDiff
    
    // Fallback to ask prices
    if (asks.length >= 2) {
      const askDiff = Math.abs(asks[0][0] - asks[1][0])
      if (askDiff > 0) return askDiff
    }
    
    return 0.01
  }

  /**
   * Round price to tick size
   */
  static roundToTickSize(price: number, tickSize: number): number {
    if (tickSize <= 0) return price
    return Math.round(price / tickSize) * tickSize
  }

  /**
   * Get random interval in milliseconds
   */
  static getRandomInterval(settings: { frequencyRangeMin: number; frequencyRangeMax: number }): number {
    const min = settings.frequencyRangeMin * 1000
    const max = settings.frequencyRangeMax * 1000
    return Math.random() * (max - min) + min
  }

  /**
   * Validate chase settings
   */
  static validateSettings(settings: any): { valid: boolean; error?: string } {
    if (settings.isPercent) {
      if (!settings.percentDistance || settings.percentDistance <= 0 || settings.percentDistance > 10) {
        return { valid: false, error: 'Percentage distance must be between 0.01% and 10%' }
      }
    } else {
      if (!settings.tickDistance || settings.tickDistance <= 0) {
        return { valid: false, error: 'Tick distance must be greater than 0' }
      }
    }
    
    if (settings.frequencyRangeMin < 5 || settings.frequencyRangeMax > 60) {
      return { valid: false, error: 'Frequency must be between 5 and 60 seconds' }
    }
    
    if (settings.frequencyRangeMin > settings.frequencyRangeMax) {
      return { valid: false, error: 'Min frequency cannot be greater than max frequency' }
    }
    
    return { valid: true }
  }
}
