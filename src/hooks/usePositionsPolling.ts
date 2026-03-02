import { useEffect, useRef, useCallback } from 'react';
import * as hl from '@nktkas/hyperliquid';
import { usePositionsStore } from '@/store/usePositionsStore';
import { useSpotPricesStore } from '@/store/useSpotPricesStore';
import { DualInfoClient } from '@/services/DualInfoClient';
import { Position, Order, AccountSummary, SpotBalance } from '@/types/positions';
import { calculateSpotEquity } from '@/utils/calculateSpotEquity';

const LOG_POSITIONS_POLLING = false;

const log = (...args: unknown[]) => {
  if (LOG_POSITIONS_POLLING) {
    console.log(...args);
  }
};

const logError = (...args: unknown[]) => {
  if (LOG_POSITIONS_POLLING) {
    console.error(...args);
  }
};

const DEX_LIST_TTL = 5 * 60 * 1000;

interface UsePositionsPollingOptions {
  userAddress: string | null;
  remoteNodeUrl?: string | null;
  enabled?: boolean;
}

export function usePositionsPolling({ 
  userAddress, 
  remoteNodeUrl, 
  enabled = true 
}: UsePositionsPollingOptions) {
  const dualClientRef = useRef<DualInfoClient | null>(null);
  const wsTransportRef = useRef<hl.WebSocketTransport | null>(null);
  const wsClientRef = useRef<hl.SubscriptionClient | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  
  const store = usePositionsStore();
  const dexListRef = useRef<any[] | null>(null);
  const dexListTimestampRef = useRef<number>(0);
  const dexRotationIndexRef = useRef<number>(0);
  
  const fetchPositionsAndOrders = useCallback(async () => {
    if (!dualClientRef.current || !userAddress) return;
    
    try {
      const client = dualClientRef.current as any;
      
      // Refresh DEX list if stale
      if (!dexListRef.current || (Date.now() - dexListTimestampRef.current) > DEX_LIST_TTL) {
        try {
          const dexs = await client.perpDexs();
          dexListRef.current = dexs || [];
          dexListTimestampRef.current = Date.now();
          log('[POSITIONS-POLLING] Refreshed DEX list:', dexListRef.current?.length, 'entries');
        } catch (e) {
          logError('[POSITIONS-POLLING] Failed to fetch perpDexs:', e);
          if (!dexListRef.current) dexListRef.current = [];
        }
      }
      
      const allDexs = dexListRef.current || [];
      const hip3Dexs = allDexs.filter((d: any) => d !== null && d?.name);
      
      // Build list of DEXs to query this cycle: always main + one rotating HIP-3
      const dexsToQuery: Array<{ name: string; dexParam: string }> = [
        { name: 'main', dexParam: '' }
      ];
      
      if (hip3Dexs.length > 0) {
        const selectedHip3 = hip3Dexs[dexRotationIndexRef.current % hip3Dexs.length];
        dexsToQuery.push({ name: selectedHip3.name, dexParam: selectedHip3.name });
        dexRotationIndexRef.current++;
      }
      
      const queriedDexNames = new Set(dexsToQuery.map(d => d.name));
      
      // Fetch spot state in parallel with first DEX query
      const spotPromise = client.spotClearinghouseState({ user: userAddress });
      
      // Query each DEX for positions and orders
      const positions: Position[] = [];
      const orders: Order[] = [];
      let mainUserState: any = null;
      
      for (const dex of dexsToQuery) {
        try {
          const params = dex.dexParam
            ? { user: userAddress, dex: dex.dexParam }
            : { user: userAddress };
          
          const [userState, openOrders] = await Promise.all([
            client.clearinghouseState(params),
            client.openOrders(params)
          ]);
          
          // Save main DEX state for account summary
          if (dex.name === 'main') {
            mainUserState = userState;
          }
          
          // Parse positions for this DEX
          if (userState?.assetPositions) {
            userState.assetPositions.forEach((assetPos: any) => {
              const pos = assetPos.position;
              if (pos && Math.abs(parseFloat(pos.szi)) > 0) {
                let liquidationPrice: number | undefined = undefined;
                if (pos.liquidationPx && pos.liquidationPx !== null && pos.liquidationPx !== 'null') {
                  const parsed = parseFloat(pos.liquidationPx);
                  if (!isNaN(parsed) && parsed > 0) {
                    liquidationPrice = parsed;
                  }
                }
                
                const rawCoin = pos.coin;
                const coin = dex.dexParam && !rawCoin.includes(':')
                  ? `${dex.dexParam}:${rawCoin}`
                  : rawCoin;
                const isHip3 = coin.includes(':');
                
                positions.push({
                  coin,
                  size: parseFloat(pos.szi),
                  entryPrice: parseFloat(pos.entryPx || 0),
                  unrealizedPnl: parseFloat(pos.unrealizedPnl || 0),
                  side: parseFloat(pos.szi) > 0 ? 'LONG' : 'SHORT',
                  leverage: parseFloat(pos.leverage?.value || 1),
                  liquidationPrice,
                  tp: null,
                  sl: null,
                  dex: dex.name,
                  isHip3
                });
              }
            });
          }
          
          // Parse orders for this DEX
          if (openOrders && Array.isArray(openOrders)) {
            openOrders.forEach((order: any) => {
              const rawCoin = order.coin || '';
              const coin = dex.dexParam && !rawCoin.includes(':')
                ? `${dex.dexParam}:${rawCoin}`
                : rawCoin;
              const isHip3 = coin.includes(':');
              const isSpot = coin.startsWith('@');
              const isReduceOnly = order.reduceOnly || order.isPositionTpsl;
              
              let displaySide: 'BUY' | 'SELL' | 'LONG' | 'SHORT';
              if (isSpot || isReduceOnly) {
                displaySide = order.side === 'B' ? 'BUY' : 'SELL';
              } else {
                displaySide = order.side === 'B' ? 'LONG' : 'SHORT';
              }
              
              orders.push({
                oid: order.oid,
                coin,
                side: displaySide,
                size: parseFloat(order.sz),
                limitPx: parseFloat(order.limitPx),
                isPositionTpsl: order.isPositionTpsl || false,
                reduceOnly: order.reduceOnly || false,
                cloid: order.cloid || null,
                timestamp: order.timestamp || Date.now(),
                orderType: order.orderType || 'Limit',
                dex: dex.name,
                isHip3
              });
            });
          }
        } catch (dexError) {
          logError(`[POSITIONS-POLLING] Error fetching ${dex.name} DEX:`, dexError);
        }
      }
      
      const spotState = await spotPromise;
      
      // Match TP/SL orders to positions
      // console.log('[POSITIONS-POLLING] Processing', orders.length, 'total orders')
      const tpslMap = new Map<string, { tp: number | null; sl: number | null }>();
      const tpslOrders = orders.filter(o => o.isPositionTpsl)
      // console.log('[POSITIONS-POLLING] Found', tpslOrders.length, 'orders with isPositionTpsl=true')
      
      orders.forEach(order => {
        if (order.isPositionTpsl) {
          const position = positions.find(p => p.coin === order.coin);
          if (position) {
            if (!tpslMap.has(order.coin)) {
              tpslMap.set(order.coin, { tp: null, sl: null });
            }
            const tpsl = tpslMap.get(order.coin)!;
            const isLong = position.side === 'LONG';
            const isProfitable = isLong ? 
              (order.limitPx > position.entryPrice) : 
              (order.limitPx < position.entryPrice);
            
            if (isProfitable) {
              tpsl.tp = order.limitPx;
            } else {
              tpsl.sl = order.limitPx;
            }
          }
        }
      });
      
      // Apply TP/SL to positions
      // console.log('[POSITIONS-POLLING] TP/SL Map:', Array.from(tpslMap.entries()))
      positions.forEach(pos => {
        const tpsl = tpslMap.get(pos.coin);
        if (tpsl) {
          pos.tp = tpsl.tp;
          pos.sl = tpsl.sl;
          // console.log(`[POSITIONS-POLLING] Set ${pos.coin} TP/SL:`, { tp: pos.tp, sl: pos.sl })
        } else {
          // console.log(`[POSITIONS-POLLING] No TP/SL found for ${pos.coin}`)
        }
      });
      
      // Parse all spot balances
      const spotBalances: SpotBalance[] = (spotState?.balances || []).map((b: any) => ({
        coin: b.coin,
        token: parseInt(b.token || 0),
        total: parseFloat(b.total || 0),
        hold: parseFloat(b.hold || 0)
      }));
      
      const usdhBalance = spotBalances.find(b => b.coin === 'USDH')?.total || 0;
      
      // Calculate total unrealized PNL from all positions
      let totalUnrealizedPnl = 0;
      positions.forEach(pos => {
        totalUnrealizedPnl += pos.unrealizedPnl;
      });
      
      // Extract base values (from main DEX state)
      const accountValue = parseFloat(mainUserState?.marginSummary?.accountValue || mainUserState?.accountValue || 0);
      const totalRawUsd = parseFloat(mainUserState?.totalRawUsd || 0);
      const withdrawable = parseFloat(mainUserState?.withdrawable || 0);
      const marginUsed = parseFloat(mainUserState?.marginSummary?.totalMarginUsed || 0);
      const totalNtlPos = parseFloat(mainUserState?.marginSummary?.totalNtlPos || 0);
      
      // Calculate SPOT equity using real-time prices from WebSocket
      const pricesStore = useSpotPricesStore.getState();
      const spotBalance = calculateSpotEquity(spotBalances, pricesStore.prices);
      
      // PERPS balance is the total perps account value (includes unrealized PNL)
      const perpsBalance = accountValue;
      
      // CROSS MARGIN RATIO - maintenance margin / portfolio value * 100
      const maintenanceMarginForRatio = parseFloat(mainUserState?.crossMaintenanceMarginUsed || 0);
      const crossMarginRatio = accountValue > 0 ? (maintenanceMarginForRatio / accountValue) * 100 : 0;
      
      // Extract MAINTENANCE MARGIN
      const maintenanceMargin = parseFloat(mainUserState?.crossMaintenanceMarginUsed || 0);
      
      // Calculate CROSS ACCOUNT LEVERAGE (notional / account value)
      const crossAccountLeverage = accountValue > 0 ? totalNtlPos / accountValue : 0;
      
      // Calculate available for trading from crossMarginSummary (correct for isolated margin)
      const crossMargin = mainUserState?.crossMarginSummary || mainUserState?.marginSummary || {};
      const crossAccountValue = parseFloat(crossMargin?.accountValue || 0);
      const crossMarginUsed = parseFloat(crossMargin?.totalMarginUsed || 0);
      const availableForTrading = crossAccountValue - crossMarginUsed;
      
      const accountSummary: AccountSummary = {
        accountValue,
        totalRawUsd,
        withdrawable,
        marginUsed,
        totalNtlPos,
        usdhBalance,
        spotBalance,
        perpsBalance,
        totalUnrealizedPnl,
        crossMarginRatio,
        maintenanceMargin,
        crossAccountLeverage,
        spotBalances,
        availableForTrading
      };
      
      // Update store with selective merge (only replace data from queried DEXs)
      store.updateAll({
        positions,
        orders,
        accountSummary,
        connected: true,
        queriedDexNames
      });
      
    } catch (error: any) {
      logError('[POSITIONS-POLLING] Error fetching data:', error);
      store.setError(error.message);
    }
  }, [userAddress, store]);
  
  const startPolling = useCallback((interval: number) => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }
    
    log(`[POSITIONS-POLLING] Starting polling with ${interval}ms interval`);
    
    pollingIntervalRef.current = setInterval(() => {
      fetchPositionsAndOrders();
    }, interval);
  }, [fetchPositionsAndOrders]);
  
  const initializeClient = useCallback(async () => {
    if (!userAddress) return;
    
    const publicTransport = new hl.HttpTransport({ isTestnet: false });
    const publicInfoClient = new hl.InfoClient({ transport: publicTransport });
    
    let remoteInfoClient: hl.InfoClient | null = null;
    let useRemote = false;
    
    if (remoteNodeUrl) {
      try {
        const remoteTransport = new hl.HttpTransport({
          apiUrl: remoteNodeUrl,
          timeout: 10000
        });
        
        remoteInfoClient = new hl.InfoClient({ transport: remoteTransport });
        useRemote = true;
        log('[POSITIONS-POLLING] 🟢 Private node enabled:', remoteNodeUrl);
      } catch (error) {
        logError('[POSITIONS-POLLING] ❌ Failed to create remote node:', error);
      }
    }
    
    const dualClient = new DualInfoClient(publicInfoClient, remoteInfoClient, useRemote);
    dualClientRef.current = dualClient;
    
    // Subscribe to fallback state changes
    const unsubscribe = dualClient.onFallbackChange((isUsingFallback, newInterval) => {
      log(`[POSITIONS-POLLING] Fallback state changed: ${isUsingFallback ? 'FALLBACK MODE' : 'NORMAL MODE'}, new interval: ${newInterval}ms`);
      store.setFallbackMode(isUsingFallback, newInterval);
      
      // Restart polling with new interval
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        startPolling(newInterval);
      }
    });
    
    unsubscribeRef.current = unsubscribe;
    
    // Initial data load
    await fetchPositionsAndOrders();
    
    // Start polling
    const initialInterval = dualClient.getPollingInterval();
    startPolling(initialInterval);
    
    store.setConnected(true);
    
  }, [userAddress, remoteNodeUrl, store, fetchPositionsAndOrders, startPolling]);
  
  const setupWebSocket = useCallback(async () => {
    if (!userAddress) return;
    
    log('[POSITIONS-POLLING] Setting up WebSocket for fallback mode...');
    
    try {
      wsTransportRef.current = new hl.WebSocketTransport({ 
        url: 'wss://api.hyperliquid.xyz/ws',
        timeout: 10000
      });
      
      wsClientRef.current = new hl.SubscriptionClient({ 
        transport: wsTransportRef.current 
      });
      
      // Subscribe to user events
      await wsClientRef.current.userEvents(
        { user: userAddress },
        (event: any) => {
          log('[POSITIONS-POLLING] WS event:', event.type);
          // Trigger refresh on any event
          fetchPositionsAndOrders();
        }
      );
      
      log('[POSITIONS-POLLING] WebSocket subscribed successfully');
      
    } catch (error) {
      logError('[POSITIONS-POLLING] WebSocket setup error:', error);
    }
  }, [userAddress, fetchPositionsAndOrders]);
  
  const cleanup = useCallback(() => {
    log('[POSITIONS-POLLING] Cleaning up...');
    
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }
    
    if (wsTransportRef.current) {
      wsTransportRef.current.close();
      wsTransportRef.current = null;
      wsClientRef.current = null;
    }
    
    if (dualClientRef.current) {
      dualClientRef.current.destroy();
      dualClientRef.current = null;
    }
  }, []);
  
  // Initialize on mount
  useEffect(() => {
    if (!enabled || !userAddress) return;
    
    initializeClient();
    
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, userAddress, remoteNodeUrl]);
  
  // Setup WebSocket when entering fallback mode
  useEffect(() => {
    if (store.isUsingFallback && userAddress) {
      setupWebSocket();
    }
    
    return () => {
      if (wsTransportRef.current) {
        wsTransportRef.current.close();
        wsTransportRef.current = null;
        wsClientRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.isUsingFallback, userAddress]);
  
  return {
    refresh: fetchPositionsAndOrders,
    cleanup
  };
}
