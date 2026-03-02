'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { sseService } from '@/services/sse-service';
import { TradeSignal } from '@/hooks/useTradeDataManager';

interface SSEData {
    allTrades: TradeSignal[];
    isConnected: boolean;
    connectionState: string;
}

const SSEContext = createContext<SSEData>({
    allTrades: [],
    isConnected: false,
    connectionState: 'disconnected'
});

// Signal sync moved to Supabase - bot gets signals via browser's realtime connection

export function SSEProvider({ children }: { children: ReactNode }) {
    const [data, setData] = useState<SSEData>({
        allTrades: [],
        isConnected: false,
        connectionState: 'disconnected'
    });

    useEffect(() => {
        // console.log('[🌍 PROVIDER] SSEProvider mounted - initializing global SSE connection');

        const handleAllTrades = (trades: TradeSignal[]) => {
            // console.log('[🌍 PROVIDER] Received', trades?.length || 0, 'historical trades');
            
            if (!trades || trades.length === 0) {
                setData(prev => ({ ...prev, allTrades: [] }));
                return;
            }

            const sorted = [...trades].sort((a, b) => {
                const timeA = new Date(a.file_timestamp || a.created_at || 0).getTime();
                const timeB = new Date(b.file_timestamp || b.created_at || 0).getTime();
                return timeB - timeA;
            });

            // console.log('[🌍 PROVIDER] Stored', sorted.length, 'trades in global state (no limit)');
            
            setData(prev => ({ ...prev, allTrades: sorted }));
        };

        const handleNewTrades = (payload: { trades: TradeSignal[] }) => {
            // console.log('[🌍 PROVIDER] Received', payload?.trades?.length || 0, 'new trades');
            
            if (!payload || !payload.trades) {
                return;
            }

            setData(prev => {
                // Randomize incoming batch by asset (grouped) to avoid alphabetical bias
                const incomingTrades = payload.trades;
                const byAsset: Record<string, TradeSignal[]> = {};
                for (const t of incomingTrades) {
                    if (!byAsset[t.asset]) byAsset[t.asset] = [];
                    byAsset[t.asset].push(t);
                }
                const assetKeys = Object.keys(byAsset);
                // Fisher-Yates shuffle on asset keys
                for (let i = assetKeys.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [assetKeys[i], assetKeys[j]] = [assetKeys[j], assetKeys[i]];
                }
                const shuffledIncoming: TradeSignal[] = [];
                for (const key of assetKeys) {
                    shuffledIncoming.push(...byAsset[key]);
                }
                
                const merged = [...shuffledIncoming, ...prev.allTrades];
                
                const unique = merged.filter((trade, index, self) => 
                    index === self.findIndex(t => t.id === trade.id)
                );

                const sorted = unique.sort((a, b) => {
                    const timeA = new Date(a.file_timestamp || a.created_at || 0).getTime();
                    const timeB = new Date(b.file_timestamp || b.created_at || 0).getTime();
                    return timeB - timeA;
                });

                // console.log('[🌍 PROVIDER] Updated global state:', sorted.length, 'trades (no limit)');
                
                return { ...prev, allTrades: sorted };
            });
        };

        const handleStateChange = (payload: any) => {
            // console.log('[🌍 PROVIDER] Connection state changed:', payload.state);
            setData(prev => ({
                ...prev,
                isConnected: payload.state === 'connected',
                connectionState: payload.state
            }));
        };

        sseService.on('trades-data', handleAllTrades);
        sseService.on('new-trades-data', handleNewTrades);
        sseService.on('state-change', handleStateChange);
        
        // console.log('[🌍 PROVIDER] Connecting to SSE...');
        sseService.connect();

        return () => {
            // console.log('[🌍 PROVIDER] SSEProvider unmounting - cleaning up');
            sseService.off('trades-data', handleAllTrades);
            sseService.off('new-trades-data', handleNewTrades);
            sseService.off('state-change', handleStateChange);
        };
    }, []);

    return <SSEContext.Provider value={data}>{children}</SSEContext.Provider>;
}

export const useSSEData = () => {
    const context = useContext(SSEContext);
    if (!context) {
        throw new Error('useSSEData must be used within SSEProvider');
    }
    return context;
};
