'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { EnhancedTradeSignal } from '@/types/trade-signal-extended';

interface AdditionalDataSectionProps {
    trade: EnhancedTradeSignal;
}

export function AdditionalDataSection({ trade }: AdditionalDataSectionProps) {
    const [isCollapsed, setIsCollapsed] = useState(false);
    
    return (
        <div className="border border-border rounded-lg overflow-hidden">
            <div 
                className="flex justify-between items-center p-3 bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => setIsCollapsed(!isCollapsed)}
            >
                <h4 className="font-semibold text-sm">Additional Data</h4>
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
                        <span className="text-xs text-muted-foreground">Trade ID</span>
                        <span className="text-xs font-mono">{trade.id.substring(0, 8)}...</span>
                    </div>
                    
                    {trade.file_timestamp && (
                        <div className="flex justify-between items-center py-2 border-b border-border/50">
                            <span className="text-xs text-muted-foreground">Signal Timestamp</span>
                            <span className="text-xs">
                                {new Date(trade.file_timestamp).toLocaleString()}
                            </span>
                        </div>
                    )}
                    
                    {trade.created_at && (
                        <div className="flex justify-between items-center py-2 border-b border-border/50">
                            <span className="text-xs text-muted-foreground">Database Entry</span>
                            <span className="text-xs">
                                {new Date(trade.created_at).toLocaleString()}
                            </span>
                        </div>
                    )}
                    
                    {trade.tp_range && (
                        <div className="flex justify-between items-center py-2 border-b border-border/50">
                            <span className="text-xs text-muted-foreground">TP Range</span>
                            <span className="text-xs font-semibold">{trade.tp_range}</span>
                        </div>
                    )}
                    
                    {trade.sl_range && (
                        <div className="flex justify-between items-center py-2 border-b border-border/50">
                            <span className="text-xs text-muted-foreground">SL Range</span>
                            <span className="text-xs font-semibold">{trade.sl_range}</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
