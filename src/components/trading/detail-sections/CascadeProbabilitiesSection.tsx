'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { EnhancedTradeSignal } from '@/types/trade-signal-extended';

interface CascadeProbabilitiesSectionProps {
    trade: EnhancedTradeSignal;
}

export function CascadeProbabilitiesSection({ trade }: CascadeProbabilitiesSectionProps) {
    const [isCollapsed, setIsCollapsed] = useState(false);
    
    const longProb = trade.enhanced_data?.summary?.long_cascade_probability;
    const shortProb = trade.enhanced_data?.summary?.short_cascade_probability;
    const overallProb = trade.enhanced_data?.summary?.overall_cascade_probability;
    const dirStrength = trade.enhanced_data?.summary?.directional_strength;
    const dominantDir = trade.enhanced_data?.summary?.dominant_cascade_direction;
    
    if (!longProb && !shortProb && !overallProb) {
        return null;
    }
    
    const getCascadeClass = (prob?: number): string => {
        if (!prob) return '';
        if (prob >= 0.7) return 'text-green-500';
        if (prob >= 0.4) return 'text-yellow-500';
        return 'text-red-500';
    };
    
    return (
        <div className="border border-border rounded-lg overflow-hidden">
            <div 
                className="flex justify-between items-center p-3 bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => setIsCollapsed(!isCollapsed)}
            >
                <h4 className="font-semibold text-sm">Cascade Probabilities</h4>
                <button className="text-xs text-muted-foreground font-bold">
                    {isCollapsed ? '+' : '−'}
                </button>
            </div>
            
            <div className={cn(
                "transition-all duration-200",
                isCollapsed ? "max-h-0 overflow-hidden" : "max-h-[400px]"
            )}>
                <div className="p-4">
                    <div className="grid grid-cols-2 gap-3 mb-4">
                        <div className="bg-background/50 p-3 rounded border border-border/50 text-center">
                            <div className="text-xs text-muted-foreground mb-2">Long Cascade</div>
                            <div className={cn(
                                "text-xl font-bold mb-1",
                                getCascadeClass(longProb)
                            )}>
                                {longProb ? (longProb * 100).toFixed(1) + '%' : 'N/A'}
                            </div>
                            <div className="text-xs text-muted-foreground uppercase tracking-wider">
                                {dominantDir === 'long' ? 'Primary' : 'Secondary'}
                            </div>
                        </div>
                        
                        <div className="bg-background/50 p-3 rounded border border-border/50 text-center">
                            <div className="text-xs text-muted-foreground mb-2">Short Cascade</div>
                            <div className={cn(
                                "text-xl font-bold mb-1",
                                getCascadeClass(shortProb)
                            )}>
                                {shortProb ? (shortProb * 100).toFixed(1) + '%' : 'N/A'}
                            </div>
                            <div className="text-xs text-muted-foreground uppercase tracking-wider">
                                {dominantDir === 'short' ? 'Primary' : 'Secondary'}
                            </div>
                        </div>
                    </div>
                    
                    <div className="space-y-2">
                        {overallProb !== undefined && (
                            <div className="flex justify-between items-center py-2 border-b border-border/50">
                                <span className="text-xs text-muted-foreground">Overall Cascade Probability</span>
                                <span className={cn("text-sm font-semibold", getCascadeClass(overallProb))}>
                                    {(overallProb * 100).toFixed(1)}%
                                </span>
                            </div>
                        )}
                        
                        {dirStrength !== undefined && (
                            <div className="flex justify-between items-center py-2 border-b border-border/50">
                                <span className="text-xs text-muted-foreground">Directional Strength</span>
                                <span className="text-sm font-semibold">
                                    {(dirStrength * 100).toFixed(1)}%
                                </span>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
