// Hook for fetching and managing enhanced trade data
import { useState, useEffect, useCallback } from 'react';
import { EnhancedTradeSignal } from '@/types/trade-signal-extended';
import { TradeSignal } from '@/hooks/useTradeDataManager';

interface UseEnhancedTradeResult {
    enhancedTrade: EnhancedTradeSignal | null;
    isLoading: boolean;
    error: Error | null;
    refetch: () => Promise<void>;
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';

export function useEnhancedTrade(
    trade: TradeSignal | null
): UseEnhancedTradeResult {
    const [enhancedTrade, setEnhancedTrade] = useState<EnhancedTradeSignal | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    
    const fetchEnhancedData = useCallback(async () => {
        if (!trade?.id) {
            setEnhancedTrade(null);
            return;
        }
        
        // Check if already has enhanced data
        const extTrade = trade as EnhancedTradeSignal;
        if (extTrade.enhanced_data?.clusters) {
            console.log('[useEnhancedTrade] Trade already has enhanced data');
            setEnhancedTrade(extTrade);
            return;
        }
        
        setIsLoading(true);
        setError(null);
        
        try {
            console.log('[useEnhancedTrade] Fetching enhanced data for trade:', trade.id);
            const response = await fetch(
                `${API_BASE_URL}/trade/${trade.id}/enhanced`
            );
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.error || 'Failed to load enhanced data');
            }
            
            console.log('[useEnhancedTrade] Enhanced data received:', result.data);
            
            // Merge enhanced data into trade
            const enhanced: EnhancedTradeSignal = {
                ...trade,
                enhanced_data: result.data
            };
            
            setEnhancedTrade(enhanced);
        } catch (err) {
            console.error('[useEnhancedTrade] Failed to fetch enhanced data:', err);
            setError(err as Error);
            
            // Fallback: use trade without enhanced data
            setEnhancedTrade(trade as EnhancedTradeSignal);
        } finally {
            setIsLoading(false);
        }
    }, [trade]);
    
    useEffect(() => {
        fetchEnhancedData();
    }, [fetchEnhancedData]);
    
    return {
        enhancedTrade,
        isLoading,
        error,
        refetch: fetchEnhancedData
    };
}
