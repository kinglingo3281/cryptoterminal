'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { EnhancedTradeSignal, PositionData } from '@/types/trade-signal-extended';

interface PositionsSectionProps {
    trade: EnhancedTradeSignal;
}

export function PositionsSection({ trade }: PositionsSectionProps) {
    const [isCollapsed, setIsCollapsed] = useState(false);
    
    const allPositions = getAllPositions(trade);
    
    if (allPositions.length === 0) {
        return null;
    }
    
    return (
        <div className="border border-border rounded-lg overflow-hidden">
            <div 
                className="flex justify-between items-center p-3 bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => setIsCollapsed(!isCollapsed)}
            >
                <h4 className="font-semibold text-sm">Individual Positions ({allPositions.length})</h4>
                <button className="text-xs text-muted-foreground font-bold">
                    {isCollapsed ? '+' : '−'}
                </button>
            </div>
            
            <div className={cn(
                "transition-all duration-200 overflow-hidden",
                isCollapsed ? "max-h-0" : "max-h-[400px] overflow-y-auto"
            )}>
                <div className="p-3 overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                        <thead>
                            <tr className="border-b border-border">
                                <th className="text-left pb-2 px-2 font-medium text-muted-foreground min-w-[100px]">TRADER</th>
                                <th className="text-left pb-2 px-2 font-medium text-muted-foreground min-w-[60px]">SIDE</th>
                                <th className="text-right pb-2 px-2 font-medium text-muted-foreground min-w-[100px]">USD SIZE</th>
                                <th className="text-right pb-2 px-2 font-medium text-muted-foreground min-w-[90px]">PRICE</th>
                                <th className="text-right pb-2 px-2 font-medium text-muted-foreground min-w-[95px]">ENTRY</th>
                                <th className="text-right pb-2 px-2 font-medium text-muted-foreground min-w-[95px]">CENTER</th>
                            </tr>
                        </thead>
                        <tbody>
                            {allPositions.map((pos, idx) => (
                                <tr key={idx} className="border-b border-border/50">
                                    <td className="py-2 px-2 text-muted-foreground truncate max-w-[100px]">
                                        {(pos.trader || pos.trader_address || 'Unknown').substring(0, 10) + '...'}
                                    </td>
                                    <td className="py-2 px-2 whitespace-nowrap">
                                        <span className={cn(
                                            "px-2 py-0.5 rounded text-xs font-medium inline-block",
                                            pos.clusterType === 'long' 
                                                ? "bg-primary/10 text-primary"
                                                : "bg-destructive/10 text-destructive"
                                        )}>
                                            {pos.clusterType || 'N/A'}
                                        </span>
                                    </td>
                                    <td className="py-2 px-2 text-right font-mono whitespace-nowrap">
                                        ${parseFloat(String(pos.usd_size || 0)) > 0 ? parseFloat(String(pos.usd_size || 0)).toLocaleString() : '-'}
                                    </td>
                                    <td className="py-2 px-2 text-right font-mono whitespace-nowrap">
                                        ${parseFloat(String(pos.price)) > 0 ? parseFloat(String(pos.price)).toFixed(4) : '-'}
                                    </td>
                                    <td className="py-2 px-2 text-right font-mono text-muted-foreground whitespace-nowrap">
                                        ${parseFloat(String(pos.entry_price || 0)) > 0 ? parseFloat(String(pos.entry_price || 0)).toFixed(4) : '-'}
                                    </td>
                                    <td className="py-2 px-2 text-right font-mono text-muted-foreground whitespace-nowrap">
                                        ${parseFloat(String(pos.clusterCenter || 0)) > 0 ? parseFloat(String(pos.clusterCenter || 0)).toFixed(4) : '-'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

function getAllPositions(trade: EnhancedTradeSignal): Array<PositionData & { clusterType?: string; clusterCenter?: number }> {
    const positions: Array<PositionData & { clusterType?: string; clusterCenter?: number }> = [];
    
    const clusters = trade.enhanced_data?.clusters;
    if (clusters) {
        const allClusters = [
            ...(clusters.long_clusters || []).map(c => ({ ...c, type: 'long' as const })),
            ...(clusters.short_clusters || []).map(c => ({ ...c, type: 'short' as const }))
        ];
        
        allClusters.forEach(cluster => {
            if (cluster.positions && Array.isArray(cluster.positions)) {
                cluster.positions.forEach(position => {
                    positions.push({
                        ...position,
                        clusterType: cluster.type,
                        clusterCenter: parseFloat(String(cluster.center_price))
                    });
                });
            }
        });
    }
    
    const uniquePositions = positions.filter((pos, index, self) => 
        index === self.findIndex(p => 
            (p.trader || p.trader_address) === (pos.trader || pos.trader_address) && 
            parseFloat(String(p.price)) === parseFloat(String(pos.price))
        )
    );
    
    return uniquePositions.sort((a, b) => 
        parseFloat(String(b.usd_size)) - parseFloat(String(a.usd_size))
    );
}

function PositionRow({ position }: { position: PositionData & { clusterType?: string; clusterCenter?: number } }) {
    const trader = (position.trader || position.trader_address || 'Unknown').substring(0, 10) + '...';
    const usdSize = parseFloat(String(position.usd_size || 0));
    const price = parseFloat(String(position.price));
    const entry = parseFloat(String(position.entry_price || 0));
    const center = position.clusterCenter || 0;
    
    return (
        <div className="grid grid-cols-6 gap-2 text-xs py-1.5 px-2 bg-background/50 border border-border/50 rounded hover:border-primary/30 transition-colors">
            <div className="font-mono text-[10px] truncate">{trader}</div>
            <div>
                <span className={cn(
                    "px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase",
                    position.clusterType === 'long' 
                        ? "bg-primary/20 text-primary"
                        : "bg-destructive/20 text-destructive"
                )}>
                    {position.clusterType || 'N/A'}
                </span>
            </div>
            <div className="font-semibold text-primary">
                {usdSize > 0 ? `$${usdSize.toLocaleString()}` : '-'}
            </div>
            <div className="font-mono">${price.toFixed(4)}</div>
            <div className="font-mono">${entry > 0 ? entry.toFixed(4) : '-'}</div>
            <div className="font-mono">${center > 0 ? center.toFixed(4) : '-'}</div>
        </div>
    );
}
