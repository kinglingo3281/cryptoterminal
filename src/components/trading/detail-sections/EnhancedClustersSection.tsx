'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { EnhancedTradeSignal, ClusterData } from '@/types/trade-signal-extended';

interface EnhancedClustersSectionProps {
    trade: EnhancedTradeSignal;
}

export function EnhancedClustersSection({ trade }: EnhancedClustersSectionProps) {
    const [isCollapsed, setIsCollapsed] = useState(false);
    
    const clusters = trade.enhanced_data?.clusters;
    const allClusters = [
        ...(clusters?.long_clusters || []),
        ...(clusters?.short_clusters || [])
    ];
    
    if (allClusters.length === 0) {
        return null;
    }
    
    return (
        <div className="border border-border rounded-lg overflow-hidden">
            <div 
                className="flex justify-between items-center p-3 bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => setIsCollapsed(!isCollapsed)}
            >
                <h4 className="font-semibold text-sm">Enhanced Clusters ({allClusters.length})</h4>
                <button className="text-xs text-muted-foreground font-bold">
                    {isCollapsed ? '+' : '−'}
                </button>
            </div>
            
            <div className={cn(
                "transition-all duration-200 overflow-hidden",
                isCollapsed ? "max-h-0" : "max-h-[400px] overflow-y-auto"
            )}>
                <div className="p-4 space-y-3">
                    {allClusters.map((cluster, idx) => (
                        <ClusterItem key={idx} cluster={cluster} />
                    ))}
                </div>
            </div>
        </div>
    );
}

function ClusterItem({ cluster }: { cluster: ClusterData }) {
    const isLong = cluster.direction === 'long';
    const centerPrice = parseFloat(String(cluster.center_price));
    const totalSize = parseFloat(String(cluster.total_size));
    
    return (
        <div className="bg-background/50 border border-border/50 rounded-lg p-3 hover:border-primary/30 transition-colors">
            <div className="flex justify-between items-start mb-3">
                <span className={cn(
                    "px-2 py-1 rounded-full text-xs font-semibold uppercase",
                    isLong 
                        ? "bg-primary/20 text-primary border border-primary/30"
                        : "bg-destructive/20 text-destructive border border-destructive/30"
                )}>
                    {cluster.direction}
                </span>
                <span className="text-sm font-semibold">
                    ${centerPrice.toFixed(4)}
                </span>
            </div>
            
            <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                    <div className="text-muted-foreground">Total Size</div>
                    <div className="font-semibold">{totalSize.toLocaleString()}</div>
                </div>
                <div>
                    <div className="text-muted-foreground">Positions</div>
                    <div className="font-semibold">{cluster.position_count || 0}</div>
                </div>
                {cluster.price_distance_pct !== undefined && (
                    <div>
                        <div className="text-muted-foreground">Distance</div>
                        <div className="font-semibold">{cluster.price_distance_pct.toFixed(2)}%</div>
                    </div>
                )}
                {cluster.composite_risk !== undefined && (
                    <div>
                        <div className="text-muted-foreground">Risk Score</div>
                        <div className="font-semibold">{cluster.composite_risk.toFixed(2)}</div>
                    </div>
                )}
            </div>
        </div>
    );
}
