'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { EnhancedTradeSignal } from '@/types/trade-signal-extended';

interface PriceInfoSectionProps {
    trade: EnhancedTradeSignal;
}

export function PriceInfoSection({ trade }: PriceInfoSectionProps) {
    const [isCollapsed, setIsCollapsed] = useState(false);
    
    const currentPrice = parseFloat(String(trade.current_price || trade.entry_price));
    const entryPrice = parseFloat(String(trade.entry_price));
    const targetPrice = parseFloat(String(trade.target_price));
    const stopPrice = parseFloat(String(trade.stop_price));
    
    let pnlPercent: number;
    if (trade.direction === 'short') {
        pnlPercent = ((entryPrice - currentPrice) / entryPrice * 100);
    } else {
        pnlPercent = ((currentPrice - entryPrice) / entryPrice * 100);
    }
    const pnlClass = pnlPercent >= 0 ? 'text-primary' : 'text-destructive';
    
    const reward = Math.abs(targetPrice - entryPrice);
    const risk = Math.abs(entryPrice - stopPrice);
    const rr = risk > 0 ? (reward / risk).toFixed(2) : '-';
    
    return (
        <div className="border border-border rounded-lg overflow-hidden">
            <div 
                className="flex justify-between items-center p-3 bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => setIsCollapsed(!isCollapsed)}
            >
                <h4 className="font-semibold text-sm">Price Information</h4>
                <button className="text-xs text-muted-foreground font-bold">
                    {isCollapsed ? '+' : '−'}
                </button>
            </div>
            
            <div className={cn(
                "transition-all duration-200",
                isCollapsed ? "max-h-0 overflow-hidden" : "max-h-[400px]"
            )}>
                <div className="p-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-background/50 p-3 rounded border border-border/50">
                            <div className="text-xs text-muted-foreground mb-1">Current Price</div>
                            <div className="text-sm font-semibold">${currentPrice.toFixed(4)}</div>
                        </div>
                        <div className="bg-background/50 p-3 rounded border border-border/50">
                            <div className="text-xs text-muted-foreground mb-1">Entry Price</div>
                            <div className="text-sm font-semibold">${entryPrice.toFixed(4)}</div>
                        </div>
                        <div className="bg-background/50 p-3 rounded border border-border/50">
                            <div className="text-xs text-muted-foreground mb-1">Target Price</div>
                            <div className="text-sm font-semibold text-primary">${targetPrice.toFixed(4)}</div>
                        </div>
                        <div className="bg-background/50 p-3 rounded border border-border/50">
                            <div className="text-xs text-muted-foreground mb-1">Stop Loss</div>
                            <div className="text-sm font-semibold text-destructive">${stopPrice.toFixed(4)}</div>
                        </div>
                        <div className="bg-background/50 p-3 rounded border border-border/50">
                            <div className="text-xs text-muted-foreground mb-1">Unrealized P&L</div>
                            <div className={cn("text-sm font-semibold", pnlClass)}>
                                {pnlPercent.toFixed(2)}%
                            </div>
                        </div>
                        <div className="bg-background/50 p-3 rounded border border-border/50">
                            <div className="text-xs text-muted-foreground mb-1">Risk/Reward</div>
                            <div className="text-sm font-semibold">{rr}</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
