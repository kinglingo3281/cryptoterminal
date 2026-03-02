'use client';

import { useEffect, useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';
import { TradeSignal } from '@/hooks/useTradeDataManager';
import { useEnhancedTrade } from '@/hooks/useEnhancedTrade';

import {
    ClusterHeatmapSection,
    PriceInfoSection,
    TradeMetricsSection,
    CascadeProbabilitiesSection,
    EnhancedClustersSection,
    PositionsSection,
    AdditionalDataSection
} from './detail-sections';

interface TradeDetailPanelProps {
    trade: TradeSignal;
    onClose: () => void;
}

export function TradeDetailPanel({ trade, onClose }: TradeDetailPanelProps) {
    console.log('[TRADE DETAIL PANEL] Rendering for trade:', trade.asset, trade.id);
    const { enhancedTrade, isLoading, error } = useEnhancedTrade(trade);
    const [isVisible, setIsVisible] = useState(false);
    
    useEffect(() => {
        console.log('[TRADE DETAIL PANEL] Setting visible state to true');
        setTimeout(() => setIsVisible(true), 10);
    }, []);
    
    const handleClose = useCallback(() => {
        setIsVisible(false);
        setTimeout(onClose, 300);
    }, [onClose]);
    
    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') handleClose();
        };
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, [handleClose]);
    
    return (
        <>
            <div 
                className={cn(
                    "fixed inset-0 bg-black/20 backdrop-blur-[2px] z-[90]",
                    "transition-opacity duration-300",
                    isVisible ? "opacity-100" : "opacity-0"
                )}
                onClick={handleClose}
            />
            
            <div className={cn(
                "fixed top-0 right-0 h-screen w-[480px]",
                "bg-card border-l border-border shadow-2xl",
                "z-[100]",
                "overflow-y-auto overflow-x-hidden",
                "transform transition-transform duration-300 ease-in-out",
                isVisible ? "translate-x-0" : "translate-x-full"
            )}>
                <div className="sticky top-0 bg-card border-b border-border p-4 z-10">
                    <div className="flex justify-between items-start">
                        <div>
                            <h3 className="text-lg font-semibold">
                                {trade.asset} {trade.direction.toUpperCase()} Trade
                            </h3>
                            <p className="text-sm text-muted-foreground">
                                Entry: ${parseFloat(String(trade.entry_price)).toFixed(4)} | 
                                Target: ${parseFloat(String(trade.target_price)).toFixed(4)}
                            </p>
                        </div>
                        <button
                            onClick={handleClose}
                            className="p-2 hover:bg-muted rounded-lg transition-colors"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>
                
                <div className="p-4 space-y-4">
                    {isLoading && (
                        <div className="flex items-center justify-center p-8">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                            <p className="ml-3 text-sm text-muted-foreground">Loading enhanced data...</p>
                        </div>
                    )}
                    
                    {error && (
                        <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
                            <p className="text-destructive text-sm font-semibold mb-1">
                                Failed to load enhanced data
                            </p>
                            <p className="text-destructive/70 text-xs">
                                {error.message}
                            </p>
                        </div>
                    )}
                    
                    {enhancedTrade && !isLoading && (
                        <>
                            <ClusterHeatmapSection trade={enhancedTrade} />
                            <PriceInfoSection trade={enhancedTrade} />
                            <TradeMetricsSection trade={enhancedTrade} />
                            <CascadeProbabilitiesSection trade={enhancedTrade} />
                            <EnhancedClustersSection trade={enhancedTrade} />
                            <PositionsSection trade={enhancedTrade} />
                            <AdditionalDataSection trade={enhancedTrade} />
                        </>
                    )}
                </div>
            </div>
        </>
    );
}
