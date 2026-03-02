import { WebSocketTransport, SubscriptionClient } from '@nktkas/hyperliquid'
import type { OrderbookData, ChaseListener } from '@/types/chase'

interface OrderbookSubscription {
  transport: WebSocketTransport
  subsClient: SubscriptionClient
  subscription: any
  listeners: Set<ChaseListener>
  lastData: OrderbookData | null
  _updateCount: number
}

export class ChaseOrderbookService {
  private subscriptions: Map<string, OrderbookSubscription> = new Map()

  /**
   * Subscribe to orderbook updates for an asset
   */
  async subscribe(asset: string, listener: ChaseListener): Promise<void> {
    const key = asset.includes(':') ? asset : asset.toUpperCase()

    // If already subscribed, just add listener
    if (this.subscriptions.has(key)) {
      const sub = this.subscriptions.get(key)!
      sub.listeners.add(listener)

      // Send last data to new listener if available
      if (sub.lastData) {
        listener(sub.lastData)
      }
      return
    }

    // Create new subscription
    let transport: WebSocketTransport | null = null
    try {
      transport = new WebSocketTransport({
        url: 'wss://api.hyperliquid.xyz/ws',
        timeout: 10000,
        resubscribe: true,
        reconnect: {
          maxRetries: Infinity,
          connectionTimeout: 10000,
          reconnectionDelay: (attempt) => Math.min(1000 * Math.pow(1.5, attempt), 30000)
        }
      })
      
      const subsClient = new SubscriptionClient({ transport })
      
      await transport.ready()

      const subscription = await subsClient.l2Book(
        {
          coin: key,
          nSigFigs: null,
          mantissa: null,
        },
        (data) => {
          const sub = this.subscriptions.get(key)
          if (!sub) return

          sub._updateCount++

          // Parse orderbook data
          const parsedData = this._parseOrderbookData(data, key)
          sub.lastData = parsedData

          // Notify all listeners
          sub.listeners.forEach(listener => {
            try {
              listener(parsedData)
            } catch (error) {
              console.error(`[ChaseOrderbook] Listener error for ${key}:`, error)
            }
          })
        }
      )

      this.subscriptions.set(key, {
        transport,
        subsClient,
        subscription,
        listeners: new Set([listener]),
        lastData: null,
        _updateCount: 0
      })
      
    } catch (error) {
      console.error(`[ChaseOrderbook] Failed to subscribe to ${key}:`, error)
      if (transport) {
        try {
          await transport.close()
        } catch (closeErr) {
          // Ignore
        }
      }
      throw error
    }
  }

  /**
   * Unsubscribe a listener from an asset
   */
  async unsubscribe(asset: string, listener: ChaseListener): Promise<void> {
    const key = asset.includes(':') ? asset : asset.toUpperCase()
    const sub = this.subscriptions.get(key)
    
    if (!sub) return
    
    sub.listeners.delete(listener)
    
    // Close WebSocket when no more listeners
    if (sub.listeners.size === 0) {
      try {
        await sub.subscription.unsubscribe()
        await sub.transport.close()
      } catch (error) {
        console.error(`[ChaseOrderbook] Error closing ${key}:`, error)
      }
      this.subscriptions.delete(key)
    }
  }

  /**
   * Parse orderbook data from WebSocket
   */
  private _parseOrderbookData(data: any, asset: string): OrderbookData {
    const levels = data?.levels || [[], []]
    const bids = levels[0] || []
    const asks = levels[1] || []
    
    const parsedBids: [number, number][] = bids.map((level: any) => [
      parseFloat(level.px),
      parseFloat(level.sz)
    ])
    
    const parsedAsks: [number, number][] = asks.map((level: any) => [
      parseFloat(level.px),
      parseFloat(level.sz)
    ])
    
    return {
      asset,
      bids: parsedBids,
      asks: parsedAsks,
      bestBid: parsedBids[0]?.[0] || 0,
      bestAsk: parsedAsks[0]?.[0] || 0,
      timestamp: Date.now()
    }
  }

  /**
   * Cleanup all subscriptions
   */
  async cleanup(): Promise<void> {
    const promises = Array.from(this.subscriptions.entries()).map(async ([key, sub]) => {
      try {
        await sub.subscription.unsubscribe()
        await sub.transport.close()
      } catch (error) {
        console.error(`[ChaseOrderbook] Error cleaning up ${key}:`, error)
      }
    })
    
    await Promise.all(promises)
    this.subscriptions.clear()
  }
}
