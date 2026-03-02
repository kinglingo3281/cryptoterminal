import { useEffect, useRef } from 'react';
import * as hl from '@nktkas/hyperliquid';
import { useSpotPricesStore } from '@/store/useSpotPricesStore';

const LOG_SPOT_PRICES_WS = false;

const log = (...args: unknown[]) => {
  if (LOG_SPOT_PRICES_WS) {
    console.log(...args);
  }
};

const logError = (...args: unknown[]) => {
  if (LOG_SPOT_PRICES_WS) {
    console.error(...args);
  }
};

export function useSpotPricesWebSocket() {
  const wsRef = useRef<hl.WebSocketTransport | null>(null);
  const clientRef = useRef<hl.SubscriptionClient | null>(null);
  
  useEffect(() => {
    let mounted = true;
    
    const setupWebSocket = async () => {
      try {
        log('[SPOT-PRICES-WS] Initializing WebSocket connection...');
        
        wsRef.current = new hl.WebSocketTransport({
          url: 'wss://api.hyperliquid.xyz/ws',
          timeout: 10000
        });
        
        clientRef.current = new hl.SubscriptionClient({
          transport: wsRef.current
        });
        
        log('[SPOT-PRICES-WS] Subscribing to allMids...');
        
        clientRef.current.allMids(
          {},
          (data: any) => {
            if (!mounted) return;
            
            if (data?.mids) {
              const prices: Record<string, number> = {};
              let count = 0;
              
              for (const [asset, price] of Object.entries(data.mids)) {
                const parsedPrice = parseFloat(price as string);
                if (!isNaN(parsedPrice)) {
                  prices[asset] = parsedPrice;
                  count++;
                }
              }
              
              useSpotPricesStore.getState().setPrices(prices);
              useSpotPricesStore.getState().setConnected(true);
              
              // console.log(`[SPOT-PRICES-WS] Updated ${count} asset prices`);
            }
          }
        );
        
        log('[SPOT-PRICES-WS] Successfully subscribed to allMids');
        
      } catch (error) {
        logError('[SPOT-PRICES-WS] WebSocket setup error:', error);
        useSpotPricesStore.getState().setConnected(false);
      }
    };
    
    setupWebSocket();
    
    return () => {
      mounted = false;
      
      if (wsRef.current) {
        log('[SPOT-PRICES-WS] Closing WebSocket connection...');
        wsRef.current.close();
        wsRef.current = null;
      }
      
      clientRef.current = null;
      useSpotPricesStore.getState().reset();
    };
  }, []);
}
