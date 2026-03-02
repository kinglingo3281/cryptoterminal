'use client';

import { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { EnhancedTradeSignal, ProcessedCluster } from '@/types/trade-signal-extended';

interface ClusterHeatmapSectionProps {
    trade: EnhancedTradeSignal;
}

export function ClusterHeatmapSection({ trade }: ClusterHeatmapSectionProps) {
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [priceRangeMultiplier, setPriceRangeMultiplier] = useState(0.2);
    const [hoveredCluster, setHoveredCluster] = useState<ProcessedCluster | null>(null);
    
    // Memoize cluster processing to avoid recalculating on every render (zoom, hover, etc.)
    const clusters = useMemo(() => processClusterData(trade), [trade]);
    const currentPrice = parseFloat(String(trade.current_price || trade.entry_price));
    
    if (clusters.length === 0) {
        return null;
    }
    
    const chartWidth = 500;
    const chartHeight = 400;
    const margin = { top: 20, right: 20, bottom: 60, left: 80 };
    const plotWidth = chartWidth - margin.left - margin.right;
    const plotHeight = chartHeight - margin.top - margin.bottom;
    
    const priceRange = currentPrice * priceRangeMultiplier;
    const yMinPrice = Math.max(0, currentPrice - priceRange);
    const yMaxPrice = currentPrice + priceRange;
    const centerY = margin.top + plotHeight - ((currentPrice - yMinPrice) / (yMaxPrice - yMinPrice)) * plotHeight;
    
    const zoomIn = () => setPriceRangeMultiplier(prev => Math.max(prev * 0.7, 0.02));
    const zoomOut = () => setPriceRangeMultiplier(prev => Math.min(prev * 1.4, 2.0));
    const zoomReset = () => setPriceRangeMultiplier(0.2);
    
    return (
        <div className="border border-border rounded-lg overflow-hidden">
            <div 
                className="flex justify-between items-center p-3 bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => setIsCollapsed(!isCollapsed)}
            >
                <h4 className="font-semibold text-sm">Liquidation Clusters Heatmap</h4>
                <button className="text-xs text-muted-foreground font-bold">
                    {isCollapsed ? '+' : '−'}
                </button>
            </div>
            
            <div className={cn(
                "transition-all duration-200 overflow-hidden",
                isCollapsed ? "max-h-0" : "max-h-[450px]"
            )}>
                <div className="p-4 relative">
                    <div className="absolute top-6 right-6 z-10 flex items-center gap-1">
                        <button 
                            onClick={zoomIn}
                            className="w-5 h-5 bg-card border border-border rounded text-xs font-semibold hover:bg-primary/10 hover:border-primary transition-colors flex items-center justify-center"
                        >
                            +
                        </button>
                        <button 
                            onClick={zoomOut}
                            className="w-5 h-5 bg-card border border-border rounded text-xs font-semibold hover:bg-primary/10 hover:border-primary transition-colors flex items-center justify-center"
                        >
                            −
                        </button>
                        <button 
                            onClick={zoomReset}
                            className="px-2 h-5 bg-card border border-border rounded text-[9px] font-semibold hover:bg-primary/10 hover:border-primary transition-colors"
                        >
                            Reset
                        </button>
                        <span className="px-2 h-5 bg-card border border-border rounded text-[9px] font-mono font-semibold text-primary flex items-center">
                            ±{(priceRangeMultiplier * 100).toFixed(0)}%
                        </span>
                    </div>
                    
                    <svg 
                        width="100%" 
                        height={chartHeight} 
                        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                        className="bg-background/50 rounded border border-border/50"
                    >
                        <defs>
                            <clipPath id="chart-clip">
                                <rect x={margin.left} y={margin.top} width={plotWidth} height={plotHeight}/>
                            </clipPath>
                        </defs>
                        
                        {renderYAxis(yMinPrice, yMaxPrice, margin, plotHeight)}
                        {renderXAxis(margin, plotWidth, chartHeight)}
                        
                        <line 
                            x1={margin.left} 
                            y1={centerY} 
                            x2={margin.left + plotWidth} 
                            y2={centerY} 
                            stroke="#2DBD85" 
                            strokeWidth="3" 
                            strokeDasharray="8,4"
                        />
                        <text 
                            x={margin.left + plotWidth + 5} 
                            y={centerY - 5} 
                            fill="#2DBD85" 
                            fontSize="11" 
                            fontWeight="bold"
                        >
                            ${currentPrice.toFixed(4)}
                        </text>
                        
                        {renderTradePriceLines(trade, margin, plotWidth, plotHeight, yMinPrice, yMaxPrice)}
                        
                        <g clipPath="url(#chart-clip)">
                            {clusters.map((cluster, idx) => 
                                renderClusterBubble(cluster, currentPrice, margin, plotWidth, plotHeight, yMinPrice, yMaxPrice, idx, setHoveredCluster)
                            )}
                        </g>
                    </svg>
                </div>
            </div>
            
            {hoveredCluster && (
                <ClusterTooltip cluster={hoveredCluster} onClose={() => setHoveredCluster(null)} />
            )}
        </div>
    );
}

function processClusterData(trade: EnhancedTradeSignal): ProcessedCluster[] {
    const clusters = trade.enhanced_data?.clusters;
    if (!clusters) return [];
    
    const allClusters = [
        ...(clusters.long_clusters || []),
        ...(clusters.short_clusters || [])
    ];
    
    return allClusters.map(cluster => {
        const isLong = cluster.direction === 'long';
        return {
            price: parseFloat(String(cluster.center_price)),
            size: parseFloat(String(cluster.total_size)),
            positions: cluster.position_count || 0,
            isLong,
            type: cluster.direction,
            // SVG fill needs actual hex values, using theme colors from globals.css
            color: isLong ? '#2DBD85' : '#E05252', // --primary : --destructive
            priceDistancePct: cluster.price_distance_pct,
            risk: cluster.composite_risk
        };
    }).filter(c => c.price > 0 && c.size > 0);
}

function renderYAxis(minPrice: number, maxPrice: number, margin: any, plotHeight: number) {
    const ticks = [];
    const numTicks = 6;
    
    for (let i = 0; i <= numTicks; i++) {
        const price = minPrice + (i / numTicks) * (maxPrice - minPrice);
        const y = margin.top + plotHeight - (i / numTicks) * plotHeight;
        
        ticks.push(
            <g key={`y-${i}`}>
                <line x1={margin.left - 5} y1={y} x2={margin.left} y2={y} stroke="#888888" strokeWidth="1"/>
                <text x={margin.left - 10} y={y + 4} textAnchor="end" fill="#888888" fontSize="11">
                    ${price.toFixed(2)}
                </text>
            </g>
        );
    }
    
    ticks.push(
        <line key="y-axis" x1={margin.left} y1={margin.top} x2={margin.left} y2={margin.top + plotHeight} stroke="#888888" strokeWidth="2"/>
    );
    
    return <g>{ticks}</g>;
}

function renderXAxis(margin: any, plotWidth: number, chartHeight: number) {
    const percentages = [0, 5, 10, 15, 20];
    const ticks = [];
    
    percentages.forEach(pct => {
        const xPos = margin.left + (pct / 20) * plotWidth;
        const y = chartHeight - margin.bottom;
        
        ticks.push(
            <g key={`x-${pct}`}>
                <line x1={xPos} y1={y} x2={xPos} y2={y + 5} stroke="#888888" strokeWidth={pct === 0 ? 2 : 1}/>
                <text x={xPos} y={y + 18} textAnchor="middle" fill="#888888" fontSize={pct === 0 ? 11 : 10}>
                    {pct}%
                </text>
            </g>
        );
    });
    
    ticks.push(
        <line key="x-axis" x1={margin.left} y1={chartHeight - margin.bottom} x2={margin.left + plotWidth} y2={chartHeight - margin.bottom} stroke="#888888" strokeWidth="2"/>
    );
    
    ticks.push(
        <text key="x-label" x={margin.left + plotWidth / 2} y={chartHeight - 10} textAnchor="middle" fill="#888888" fontSize="12" fontWeight="bold">
            Distance from Current Price (%)
        </text>
    );
    
    return <g>{ticks}</g>;
}

function renderTradePriceLines(trade: EnhancedTradeSignal, margin: any, plotWidth: number, plotHeight: number, yMinPrice: number, yMaxPrice: number) {
    const lines = [];
    
    const priceToY = (price: number) => {
        return margin.top + plotHeight - ((price - yMinPrice) / (yMaxPrice - yMinPrice)) * plotHeight;
    };
    
    const entryPrice = parseFloat(String(trade.entry_price));
    const entryY = priceToY(entryPrice);
    lines.push(
        <g key="entry">
            <line x1={margin.left} y1={entryY} x2={margin.left + plotWidth} y2={entryY} 
                  stroke="#fbbf24" strokeWidth="2" strokeDasharray="6,3" opacity="0.7"/>
            <text x={margin.left + plotWidth + 5} y={entryY - 5} fill="#fbbf24" fontSize="11" fontWeight="500" opacity="0.8">
                Entry
            </text>
        </g>
    );
    
    const tpPrice = parseFloat(String(trade.target_price));
    const tpY = priceToY(tpPrice);
    lines.push(
        <g key="tp">
            <line x1={margin.left} y1={tpY} x2={margin.left + plotWidth} y2={tpY} 
                  stroke="#2DBD85" strokeWidth="2" strokeDasharray="4,2" opacity="0.7"/>
            <text x={margin.left + plotWidth + 5} y={tpY - 5} fill="#2DBD85" fontSize="11" fontWeight="500" opacity="0.8">
                TP
            </text>
        </g>
    );
    
    const slPrice = parseFloat(String(trade.stop_price));
    const slY = priceToY(slPrice);
    lines.push(
        <g key="sl">
            <line x1={margin.left} y1={slY} x2={margin.left + plotWidth} y2={slY} 
                  stroke="#E05252" strokeWidth="2" strokeDasharray="3,2" opacity="0.7"/>
            <text x={margin.left + plotWidth + 5} y={slY - 5} fill="#E05252" fontSize="11" fontWeight="500" opacity="0.8">
                SL
            </text>
        </g>
    );
    
    return <g>{lines}</g>;
}

function renderClusterBubble(
    cluster: ProcessedCluster, 
    currentPrice: number, 
    margin: any, 
    plotWidth: number, 
    plotHeight: number, 
    yMinPrice: number, 
    yMaxPrice: number,
    idx: number,
    onClick: (cluster: ProcessedCluster) => void
) {
    const y = margin.top + plotHeight - ((cluster.price - yMinPrice) / (yMaxPrice - yMinPrice)) * plotHeight;
    
    const priceDistancePct = Math.abs(cluster.price - currentPrice) / currentPrice * 100;
    const maxDistancePct = 20;
    const xOffset = Math.min(priceDistancePct / maxDistancePct, 1) * (plotWidth / 2);
    const jitter = (cluster.size % 1000) / 1000 * 20 - 10;
    const x = margin.left + xOffset + jitter;
    
    const minRadius = 4;
    const maxRadius = 18;
    const sizeRatio = Math.log(cluster.size + 1) / Math.log(1000000);
    const radius = minRadius + (sizeRatio * (maxRadius - minRadius));
    
    return (
        <g key={idx}>
            <circle 
                cx={x} 
                cy={y} 
                r={radius} 
                fill={cluster.color} 
                fillOpacity="0.75" 
                stroke="white" 
                strokeWidth="1.5"
                className="cursor-pointer hover:stroke-primary hover:stroke-2 transition-all"
                onClick={() => onClick(cluster)}
            />
            <text 
                x={x} 
                y={y + 3} 
                textAnchor="middle" 
                fill="white" 
                fontSize={Math.max(8, Math.min(11, radius * 0.6))} 
                fontWeight="600"
                pointerEvents="none"
                style={{ textShadow: '0 0 2px rgba(0,0,0,0.8)' }}
            >
                {cluster.positions}
            </text>
        </g>
    );
}

function ClusterTooltip({ cluster, onClose }: { cluster: ProcessedCluster; onClose: () => void }) {
    return (
        <div 
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm"
            onClick={onClose}
        >
            <div 
                className="bg-card border border-border rounded-lg p-6 max-w-md shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex justify-between items-start mb-4">
                    <div>
                        <h4 className="text-lg font-semibold mb-2">
                            {cluster.type.toUpperCase()} Cluster
                        </h4>
                        <span className={cn(
                            "px-2 py-1 rounded-full text-xs font-semibold uppercase",
                            cluster.isLong 
                                ? "bg-primary/20 text-primary border border-primary/30"
                                : "bg-destructive/20 text-destructive border border-destructive/30"
                        )}>
                            {cluster.type}
                        </span>
                    </div>
                    <button 
                        onClick={onClose}
                        className="text-2xl text-muted-foreground hover:text-foreground transition-colors"
                    >
                        ×
                    </button>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <div className="text-xs text-muted-foreground mb-1">Center Price</div>
                        <div className="text-sm font-semibold">${cluster.price.toFixed(4)}</div>
                    </div>
                    <div>
                        <div className="text-xs text-muted-foreground mb-1">Total Size</div>
                        <div className="text-sm font-semibold">{cluster.size.toLocaleString()}</div>
                    </div>
                    <div>
                        <div className="text-xs text-muted-foreground mb-1">Positions</div>
                        <div className="text-sm font-semibold">{cluster.positions}</div>
                    </div>
                    {cluster.priceDistancePct !== undefined && (
                        <div>
                            <div className="text-xs text-muted-foreground mb-1">Distance</div>
                            <div className="text-sm font-semibold">{cluster.priceDistancePct.toFixed(2)}%</div>
                        </div>
                    )}
                    {cluster.risk !== undefined && (
                        <div>
                            <div className="text-xs text-muted-foreground mb-1">Risk Level</div>
                            <div className="text-sm font-semibold">{cluster.risk.toFixed(2)}</div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
