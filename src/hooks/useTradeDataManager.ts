// Trade Data Manager - React hook for managing live signal data
import { useState, useEffect, useCallback, useRef } from 'react';
import { sseService } from '@/services/sse-service';

export interface TradeSignal {
    id: string;
    asset: string;
    direction: 'long' | 'short';
    entry_price: number;
    target_price: number;
    stop_price: number;
    confidence: number;
    reward_risk?: number;
    signal_type?: string;
    file_timestamp?: string;
    created_at?: string;
    timestamp?: string;
}

interface TradeDataState {
    allTrades: TradeSignal[];
    incomingTrades: TradeSignal[];
    allAssets: string[];
    isConnected: boolean;
    connectionState: string;
}

export function useTradeDataManager() {
    const [state, setState] = useState<TradeDataState>({
        allTrades: [],
        incomingTrades: [],
        allAssets: [],
        isConnected: false,
        connectionState: 'disconnected'
    });

    const incomingTradesRef = useRef<TradeSignal[]>([]);

    // Handle new trades data - merge into allTrades with 100 limit
    const handleNewTrades = useCallback((data: { trades: TradeSignal[] }) => {
        console.log('[📥 HOOK] handleNewTrades called with data:', data);
        
        if (!data || !data.trades) {
            console.warn('[⚠️ HOOK] No trades data received');
            return;
        }

        console.log('[📥 HOOK] Received', data.trades.length, 'new trades');

        setState(prev => {
            // Merge new trades with existing allTrades
            const merged = [...data.trades, ...prev.allTrades];
            
            // Deduplicate by ID (keep newest)
            const uniqueTrades = merged.filter((trade, index, self) => 
                index === self.findIndex(t => t.id === trade.id)
            );

            // Sort by timestamp (newest first)
            const sorted = uniqueTrades.sort((a, b) => {
                const timeA = new Date(a.file_timestamp || a.created_at || 0).getTime();
                const timeB = new Date(b.file_timestamp || b.created_at || 0).getTime();
                return timeB - timeA;
            });

            // Limit to 100 newest trades
            const limited = sorted.slice(0, 100);

            console.log('[📥 HOOK] After merge/dedupe/limit:', limited.length, 'trades (added', data.trades.length, 'new)');

            return {
                ...prev,
                allTrades: limited,
                incomingTrades: []
            };
        });
    }, []);

    // Handle all trades data (historical) - limit to 100 newest on initial load
    const handleAllTrades = useCallback((trades: TradeSignal[]) => {
        if (!trades || trades.length === 0) {
            setState(prev => ({ ...prev, allTrades: [] }));
            return;
        }

        // Sort by timestamp (newest first) and limit to 100
        const sorted = [...trades].sort((a, b) => {
            const timeA = new Date(a.file_timestamp || a.created_at || 0).getTime();
            const timeB = new Date(b.file_timestamp || b.created_at || 0).getTime();
            return timeB - timeA;
        });

        const limited = sorted.slice(0, 100);
        
        console.log('[📥 HOOK] Received', trades.length, 'historical trades, limited to', limited.length);
        
        setState(prev => ({
            ...prev,
            allTrades: limited
        }));
    }, []);

    // Handle assets data
    const handleAssets = useCallback((assets: string[]) => {
        setState(prev => ({
            ...prev,
            allAssets: assets || []
        }));
    }, []);

    // Handle connection state changes
    const handleStateChange = useCallback((data: { state: string }) => {
        console.log('[🔄 HOOK] Connection state changed to:', data.state);
        setState(prev => ({
            ...prev,
            connectionState: data.state,
            isConnected: data.state === 'connected'
        }));
    }, []);

    // Connect to SSE on mount
    useEffect(() => {
        console.log('[🎣 HOOK] useTradeDataManager mounted - initializing SSE connection');
        
        // Setup event listeners
        console.log('[🎣 HOOK] Registering event listeners...');
        sseService.on('new-trades-data', handleNewTrades);
        sseService.on('trades-data', handleAllTrades);
        sseService.on('assets-data', handleAssets);
        sseService.on('state-change', handleStateChange);
        console.log('[🎣 HOOK] Event listeners registered');
        
        // Connect to SSE
        console.log('[🎣 HOOK] Calling sseService.connect()...');
        sseService.connect().catch(error => {
            console.error('[❌ HOOK] Failed to connect to SSE:', error);
        });

        // Cleanup on unmount
        return () => {
            console.log('[🎣 HOOK] useTradeDataManager unmounting - cleaning up listeners');
            sseService.off('new-trades-data', handleNewTrades);
            sseService.off('trades-data', handleAllTrades);
            sseService.off('assets-data', handleAssets);
            sseService.off('state-change', handleStateChange);
        };
    }, [handleNewTrades, handleAllTrades, handleAssets, handleStateChange]);

    // Manual reconnect function
    const reconnect = useCallback(async () => {
        try {
            await sseService.disconnect();
            await sseService.connect();
        } catch (error) {
            console.error('Failed to reconnect:', error);
        }
    }, []);

    // Clear incoming trades manually
    const clearIncomingTrades = useCallback(() => {
        incomingTradesRef.current = [];
        setState(prev => ({
            ...prev,
            incomingTrades: []
        }));
    }, []);

    return {
        ...state,
        reconnect,
        clearIncomingTrades,
        connectionInfo: sseService.getConnectionInfo()
    };
}
