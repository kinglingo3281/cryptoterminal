'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { EnhancedTradeSignal } from '@/types/trade-signal-extended';

interface TradeMetricsSectionProps {
    trade: EnhancedTradeSignal;
}

export function TradeMetricsSection({ trade }: TradeMetricsSectionProps) {
    const [isCollapsed, setIsCollapsed] = useState(false);
    
    const formatSignalType = (signalType?: string): string => {
        if (!signalType) return 'N/A';
        
        switch (signalType) {
            case 'ta_based':
            case 'enhanced':
                return 'Enhanced';
            case 'ta_range':
                return 'Ranging';
            case 'standard':
            case 'pure_liquidity':
                return 'Pure Liquidity';
            case 'v3':
                return 'V3';
            default:
                return signalType;
        }
    };
    
    return (
        <div className="border border-border rounded-lg overflow-hidden">
            <div 
                className="flex justify-between items-center p-3 bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => setIsCollapsed(!isCollapsed)}
            >
                <h4 className="font-semibold text-sm">Trade Metrics</h4>
                <button className="text-xs text-muted-foreground font-bold">
                    {isCollapsed ? '+' : '−'}
                </button>
            </div>
            
            <div className={cn(
                "transition-all duration-200",
                isCollapsed ? "max-h-0 overflow-hidden" : "max-h-[400px]"
            )}>
                <div className="p-4 space-y-2">
                    <div className="flex justify-between items-center py-2 border-b border-border/50">
                        <span className="text-xs text-muted-foreground">Confidence</span>
                        <span className="text-sm font-semibold">
                            {(parseFloat(String(trade.confidence)) * 100).toFixed(1)}%
                        </span>
                    </div>
                    
                    <div className="flex justify-between items-center py-2 border-b border-border/50">
                        <span className="text-xs text-muted-foreground">Signal Type</span>
                        <span className="text-sm font-semibold">
                            {formatSignalType(trade.signal_type)}
                        </span>
                    </div>
                    
                    {trade.tp_hours && (
                        <div className="flex justify-between items-center py-2 border-b border-border/50">
                            <span className="text-xs text-muted-foreground">TP Hours</span>
                            <span className="text-sm font-semibold">{trade.tp_hours}</span>
                        </div>
                    )}
                    
                    {trade.sl_hours && (
                        <div className="flex justify-between items-center py-2 border-b border-border/50">
                            <span className="text-xs text-muted-foreground">SL Hours</span>
                            <span className="text-sm font-semibold">{trade.sl_hours}</span>
                        </div>
                    )}
                    
                    {trade.duration_confidence && (
                        <div className="flex justify-between items-center py-2 border-b border-border/50">
                            <span className="text-xs text-muted-foreground">Duration Confidence</span>
                            <span className="text-sm font-semibold">
                                {(parseFloat(String(trade.duration_confidence)) * 100).toFixed(1)}%
                            </span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
