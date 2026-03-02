'use client';

import { TradeSignal } from '@/hooks/useTradeDataManager';
import { useSSEData } from '@/providers/SSEProvider';
import { TrendingUp, TrendingDown, Clock, Target, Shield, Activity, Copy, ExternalLink, ChevronDown } from 'lucide-react';
import { useMemo, useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { QuickTradeButton } from './QuickTradeButton';
import { useQuickTrade } from '@/hooks/useQuickTrade';
import { toast } from 'sonner';

interface AISignalsPanelProps {
    onSignalClick?: (signal: TradeSignal) => void;
    className?: string;
}

export function AISignalsPanel({ onSignalClick, className }: AISignalsPanelProps) {
    const { allTrades, isConnected, connectionState } = useSSEData();
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [currentPage, setCurrentPage] = useState(1);
    const tradesPerPage = 100;
    const [quickTradeCooldowns, setQuickTradeCooldowns] = useState<Set<string>>(new Set());
    const [positionSize, setPositionSize] = useState('2.5%');
    const { executeQuickTrade, isExecuting } = useQuickTrade();
    
    // Filter state
    const [filters, setFilters] = useState({
        asset: '',
        direction: '',
        signalTypes: [] as string[],
        minConfidence: 0,
        minRR: 0,
        positionSize: ''
    });
    
    // Sorting state
    const [sortColumn, setSortColumn] = useState<string>('file_timestamp');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
    
    // Helper functions (defined before useMemo to avoid reference errors)
    const formatPrice = (price: number | string): string => {
        const num = typeof price === 'string' ? parseFloat(price) : price;
        if (isNaN(num) || num === null || num === undefined) return '-';
        if (num >= 1000) return num.toFixed(2);
        if (num >= 1) return num.toFixed(4);
        return num.toFixed(6);
    };

    const calculateRR = (signal: TradeSignal): string => {
        const entry = parseFloat(signal.entry_price as any);
        const tp = parseFloat(signal.target_price as any);
        const sl = parseFloat(signal.stop_price as any);
        
        if (!entry || !tp || !sl || isNaN(entry) || isNaN(tp) || isNaN(sl)) return '-';
        
        const reward = Math.abs(tp - entry);
        const risk = Math.abs(entry - sl);
        
        if (risk === 0) return '-';
        return (reward / risk).toFixed(2);
    };

    const getSignalTypeDisplay = (signalType?: string): string => {
        if (!signalType) return '';
        
        const signalTypeMap: Record<string, string> = {
            'standard': 'Liquidity',
            'pure_liquidity': 'Liquidity',
            'ta_based': 'Enhanced',
            'enhanced': 'Enhanced',
            'ta_range': 'Ranging',
            'v3': 'V3'
        };
        
        return signalTypeMap[signalType] || signalType;
    };

    const getSignalTypeBadge = (signalType?: string) => {
        if (!signalType) return null;
        return (
            <span className="text-xs text-chart-2">
                {getSignalTypeDisplay(signalType)}
            </span>
        );
    };

    const formatTime = (signal: TradeSignal): string => {
        const timestamp = signal.file_timestamp || signal.created_at || signal.timestamp;
        if (!timestamp) return 'Just now';
        
        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        
        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        
        const diffHours = Math.floor(diffMins / 60);
        if (diffHours < 24) return `${diffHours}h ago`;
        
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };
    
    // Count signals under 15 minutes old
    const newSignalsCount = useMemo(() => {
        const fifteenMinsAgo = Date.now() - (15 * 60 * 1000);
        return allTrades.filter(trade => {
            const timestamp = trade.file_timestamp || trade.created_at || trade.timestamp;
            if (!timestamp) return false;
            const tradeTime = new Date(timestamp).getTime();
            return tradeTime >= fifteenMinsAgo;
        }).length;
    }, [allTrades]);
    
    // Get unique assets for filter dropdown
    const uniqueAssets = useMemo(() => {
        const assets = new Set(allTrades.map(t => t.asset));
        return Array.from(assets).sort();
    }, [allTrades]);
    
    // Apply filters
    const filteredTrades = useMemo(() => {
        return allTrades.filter(trade => {
            if (filters.asset && trade.asset !== filters.asset) return false;
            if (filters.direction && trade.direction !== filters.direction) return false;
            if (filters.signalTypes.length > 0 && !filters.signalTypes.includes(trade.signal_type || '')) return false;
            if ((trade.confidence || 0) < filters.minConfidence) return false;
            
            if (filters.minRR > 0) {
                const rr = parseFloat(calculateRR(trade));
                if (isNaN(rr) || rr < filters.minRR) return false;
            }
            
            return true;
        });
    }, [allTrades, filters]);
    
    // Apply sorting
    const sortedSignals = useMemo(() => {
        return [...filteredTrades].sort((a, b) => {
            let valueA: any = a[sortColumn as keyof TradeSignal];
            let valueB: any = b[sortColumn as keyof TradeSignal];
            
            // Handle timestamps
            if (sortColumn === 'file_timestamp' || sortColumn === 'created_at') {
                valueA = new Date(valueA || 0).getTime();
                valueB = new Date(valueB || 0).getTime();
            }
            // Handle numbers
            else if (sortColumn === 'confidence' || sortColumn === 'entry_price' || sortColumn === 'target_price' || sortColumn === 'stop_price') {
                valueA = parseFloat(valueA as any) || 0;
                valueB = parseFloat(valueB as any) || 0;
            }
            // Handle R/R calculation
            else if (sortColumn === 'risk_reward') {
                valueA = parseFloat(calculateRR(a));
                valueB = parseFloat(calculateRR(b));
            }
            
            const comparison = valueA > valueB ? 1 : valueA < valueB ? -1 : 0;
            return sortOrder === 'asc' ? comparison : -comparison;
        });
    }, [filteredTrades, sortColumn, sortOrder]);
    
    // Calculate pagination
    const totalPages = Math.ceil(sortedSignals.length / tradesPerPage);
    const startIndex = (currentPage - 1) * tradesPerPage;
    const endIndex = startIndex + tradesPerPage;
    const currentPageTrades = sortedSignals.slice(startIndex, endIndex);
    
    // Keep user on page 1 when new trades arrive if already on page 1
    // Otherwise stay on current page to avoid disrupting viewing older trades
    useEffect(() => {
        if (currentPage > totalPages && totalPages > 0) {
            setCurrentPage(totalPages);
        }
    }, [totalPages, currentPage]);

    const handleCopySignal = (signal: TradeSignal, e: React.MouseEvent) => {
        e.stopPropagation();
        const text = `${signal.asset} ${signal.direction.toUpperCase()}\nEntry: $${formatPrice(signal.entry_price)}\nTarget: $${formatPrice(signal.target_price)}\nStop: $${formatPrice(signal.stop_price)}\nR/R: ${calculateRR(signal)}`;
        navigator.clipboard.writeText(text);
        setCopiedId(signal.id);
        setTimeout(() => setCopiedId(null), 2000);
    };

    const handleQuickTrade = async (signal: TradeSignal, e: React.MouseEvent) => {
        e.stopPropagation();
        
        // Add to cooldown set immediately
        setQuickTradeCooldowns(prev => new Set(prev).add(signal.id));
        
        try {
            console.log('[Quick Trade] Executing for:', signal.asset, signal.direction);
            
            const result = await executeQuickTrade(signal, positionSize, true);
            
            if (result.success) {
                console.log('[Quick Trade] Success:', result);
                toast.success(`${signal.asset} ${signal.direction.toUpperCase()}`, { description: `Size: ${result.size?.toFixed(6) ?? 'N/A'} · Notional: $${result.notional?.toFixed(2) ?? 'N/A'}` });
            } else {
                console.error('[Quick Trade] Failed:', result.error);
                toast.error(`Quick trade failed: ${result.error}`);
            }
        } catch (error: any) {
            console.error('[Quick Trade] Error:', error);
            toast.error(error.message || 'Unknown error occurred');
        } finally {
            // Remove from cooldown after 3 seconds
            setTimeout(() => {
                setQuickTradeCooldowns(prev => {
                    const newSet = new Set(prev);
                    newSet.delete(signal.id);
                    return newSet;
                });
            }, 3000);
        }
    };
    
    const handleSort = (column: string) => {
        if (sortColumn === column) {
            setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
        } else {
            setSortColumn(column);
            setSortOrder('desc');
        }
        setCurrentPage(1);
    };
    
    const toggleSignalType = (type: string) => {
        setFilters(prev => ({
            ...prev,
            signalTypes: prev.signalTypes.includes(type)
                ? prev.signalTypes.filter(t => t !== type)
                : [...prev.signalTypes, type]
        }));
        setCurrentPage(1);
    };

    return (
        <div className="rainbow-card-wrapper h-full">
            <div className="rainbow-glow" />
            <div className={cn("flex flex-col h-full bg-card rounded-lg overflow-hidden relative z-10", className)}>
                {/* Header with Filters */}
            <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border bg-background/50 text-sm">
                <div className="flex items-center gap-2">
                    <Activity className="w-3.5 h-3.5 text-primary" />
                    <h3 className="text-sm font-semibold text-foreground">AI Signals</h3>
                    <span className="px-2 py-1 text-sm font-medium bg-primary/10 text-primary rounded">
                        {newSignalsCount} New
                    </span>
                    <span className="text-sm text-muted-foreground font-medium">/</span>
                    <span className="px-2 py-1 text-sm font-medium bg-primary/10 text-primary rounded">
                        {allTrades.length}
                    </span>
                    {totalPages > 1 && (
                        <div className="flex items-center gap-1">
                            <span className="text-sm text-muted-foreground">Page {currentPage}/{totalPages}</span>
                            <button
                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                disabled={currentPage === 1}
                                className="px-2 py-1 text-sm hover:bg-muted rounded disabled:opacity-30 transition-colors"
                            >
                                ←
                            </button>
                            <button
                                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                disabled={currentPage === totalPages}
                                className="px-2 py-1 text-sm hover:bg-muted rounded disabled:opacity-30 transition-colors"
                            >
                                →
                            </button>
                        </div>
                    )}
                </div>

                <select
                    value={filters.asset}
                    onChange={(e) => { setFilters(prev => ({ ...prev, asset: e.target.value })); setCurrentPage(1); }}
                    className="w-28 px-2 py-1 bg-background border border-border rounded text-sm hover:bg-muted transition-colors"
                >
                    <option value="">All Assets</option>
                    {uniqueAssets.map(asset => (
                        <option key={asset} value={asset}>{asset}</option>
                    ))}
                </select>

                <select
                    value={filters.direction}
                    onChange={(e) => { setFilters(prev => ({ ...prev, direction: e.target.value })); setCurrentPage(1); }}
                    className="w-36 px-2 py-1 bg-background border border-border rounded text-sm hover:bg-muted transition-colors"
                >
                    <option value="">All Directions</option>
                    <option value="long">Long</option>
                    <option value="short">Short</option>
                </select>

                <div className="relative group">
                    <button className="w-28 px-2 py-1 bg-background border border-border rounded text-sm hover:bg-muted transition-colors flex items-center justify-between">
                        Signal Type
                        <ChevronDown className="w-3 h-3 text-foreground" />
                    </button>
                    <div className="hidden group-hover:block absolute top-full left-0 mt-1 bg-background border border-border rounded shadow-lg z-10 min-w-[120px]">
                        {['standard', 'ta_based', 'ta_range', 'v3'].map(type => (
                            <label key={type} className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={filters.signalTypes.includes(type)}
                                    onChange={() => toggleSignalType(type)}
                                    className="w-3 h-3"
                                />
                                <span>{getSignalTypeDisplay(type)}</span>
                            </label>
                        ))}
                    </div>
                </div>

                <input
                    type="number"
                    placeholder="Min Confidence"
                    min="0"
                    max="1"
                    step="0.1"
                    value={filters.minConfidence || ''}
                    onChange={(e) => { setFilters(prev => ({ ...prev, minConfidence: parseFloat(e.target.value) || 0 })); setCurrentPage(1); }}
                    className="w-36 px-2 py-1 bg-background border border-border rounded text-sm hover:bg-muted transition-colors"
                />

                <input
                    type="number"
                    placeholder="Min Reward/Risk"
                    min="0"
                    step="0.1"
                    value={filters.minRR || ''}
                    onChange={(e) => { setFilters(prev => ({ ...prev, minRR: parseFloat(e.target.value) || 0 })); setCurrentPage(1); }}
                    className="w-36 px-2 py-1 bg-background border border-border rounded text-sm hover:bg-muted transition-colors"
                />

                <div className="relative group flex items-center gap-1 px-2 py-1 bg-primary/10 border border-primary/30 rounded">
                    <label className="text-xs text-primary font-medium whitespace-nowrap cursor-help">Size:</label>
                    <input
                        type="text"
                        value={positionSize}
                        onChange={(e) => setPositionSize(e.target.value)}
                        className="w-16 bg-transparent border-none text-xs text-foreground focus:outline-none font-mono"
                        placeholder="15"
                    />
                    <div className="absolute left-0 top-full mt-1 hidden group-hover:block bg-popover border border-border rounded px-2 py-1 text-xs text-popover-foreground shadow-md z-50 whitespace-nowrap">
                        Pre-leverage margin: $ default, add % for % of account
                    </div>
                </div>
                
                {filteredTrades.length !== allTrades.length && (
                    <span className="text-sm text-muted-foreground">
                        Showing {filteredTrades.length} of {allTrades.length}
                    </span>
                )}

                <div className="ml-auto flex items-center gap-2">
                    <div className={cn("flex items-center gap-1 px-1.5 py-0.5 rounded text-sm", 
                        isConnected 
                            ? "bg-primary/10 text-primary" 
                            : "bg-destructive/10 text-destructive"
                    )}>
                        <div className={cn("w-1 h-1 rounded-full", 
                            isConnected ? "bg-primary animate-pulse" : "bg-destructive"
                        )} />
                        {connectionState.charAt(0).toUpperCase() + connectionState.slice(1)}
                    </div>
                </div>
            </div>

            {/* Signals List */}
            <div className="flex-1 overflow-y-auto">
                {!isConnected && allTrades.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full p-4 text-center">
                        <Activity className="w-8 h-8 text-muted-foreground/50 mb-2" />
                        <p className="text-sm text-muted-foreground">Connecting...</p>
                    </div>
                ) : allTrades.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full p-4 text-center">
                        <Activity className="w-8 h-8 text-muted-foreground/50 mb-2" />
                        <p className="text-sm text-muted-foreground">No active signals</p>
                        <p className="text-sm text-muted-foreground/70 mt-1">Waiting for AI signals...</p>
                    </div>
                ) : (
                    <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-secondary/40 border-b border-border">
                            <tr>
                                <th 
                                    onClick={() => handleSort('asset')}
                                    className="px-3 py-2 text-left font-medium cursor-pointer hover:bg-muted transition-colors"
                                >
                                    <div className="flex items-center gap-1">
                                        Asset
                                        {sortColumn === 'asset' && <span className="text-primary">{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                                    </div>
                                </th>
                                <th 
                                    onClick={() => handleSort('direction')}
                                    className="px-3 py-2 text-left font-medium cursor-pointer hover:bg-muted transition-colors"
                                >
                                    <div className="flex items-center gap-1">
                                        Direction
                                        {sortColumn === 'direction' && <span className="text-primary">{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                                    </div>
                                </th>
                                <th 
                                    onClick={() => handleSort('entry_price')}
                                    className="px-3 py-2 text-left font-medium cursor-pointer hover:bg-muted transition-colors"
                                >
                                    <div className="flex items-center gap-1">
                                        Entry
                                        {sortColumn === 'entry_price' && <span className="text-primary">{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                                    </div>
                                </th>
                                <th 
                                    onClick={() => handleSort('target_price')}
                                    className="px-3 py-2 text-left font-medium cursor-pointer hover:bg-muted transition-colors"
                                >
                                    <div className="flex items-center gap-1">
                                        Target
                                        {sortColumn === 'target_price' && <span className="text-primary">{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                                    </div>
                                </th>
                                <th 
                                    onClick={() => handleSort('stop_price')}
                                    className="px-3 py-2 text-left font-medium cursor-pointer hover:bg-muted transition-colors"
                                >
                                    <div className="flex items-center gap-1">
                                        Stop
                                        {sortColumn === 'stop_price' && <span className="text-primary">{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                                    </div>
                                </th>
                                <th 
                                    onClick={() => handleSort('confidence')}
                                    className="px-3 py-2 text-left font-medium cursor-pointer hover:bg-muted transition-colors"
                                >
                                    <div className="flex items-center gap-1">
                                        Conf
                                        {sortColumn === 'confidence' && <span className="text-primary">{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                                    </div>
                                </th>
                                <th 
                                    onClick={() => handleSort('risk_reward')}
                                    className="px-3 py-2 text-left font-medium cursor-pointer hover:bg-muted transition-colors"
                                >
                                    <div className="flex items-center gap-1">
                                        R/R
                                        {sortColumn === 'risk_reward' && <span className="text-primary">{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                                    </div>
                                </th>
                                <th 
                                    onClick={() => handleSort('file_timestamp')}
                                    className="px-3 py-2 text-left font-medium cursor-pointer hover:bg-muted transition-colors"
                                >
                                    <div className="flex items-center gap-1">
                                        Time
                                        {sortColumn === 'file_timestamp' && <span className="text-primary">{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                                    </div>
                                </th>
                                <th className="px-3 py-2 text-left font-medium w-20">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {currentPageTrades.map((signal) => (
                                <tr
                                    key={signal.id}
                                    onClick={() => {
                                        console.log('[AISignalsPanel] Row clicked:', signal.asset, signal.id);
                                        onSignalClick?.(signal);
                                    }}
                                    className="hover:bg-muted/50 transition-colors border-b border-border/50 cursor-pointer"
                                >
                                    <td className="px-3 py-2">{signal.asset} {getSignalTypeBadge(signal.signal_type)}</td>
                                    <td className="px-3 py-2">
                                        <div className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium",
                                            signal.direction === 'long' ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"
                                        )}>
                                            {signal.direction === 'long' ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                                            <span className="font-medium">{signal.direction.toUpperCase()}</span>
                                        </div>
                                    </td>
                                    
                                    {/* Entry */}
                                    <td className="px-3 py-2 font-mono text-foreground">${formatPrice(signal.entry_price)}</td>
                                    
                                    {/* Target */}
                                    <td className="px-3 py-2 font-mono text-primary">${formatPrice(signal.target_price)}</td>
                                    
                                    {/* Stop */}
                                    <td className="px-3 py-2 font-mono text-destructive">${formatPrice(signal.stop_price)}</td>
                                    
                                    {/* Confidence */}
                                    <td className="px-3 py-2">
                                        <div className="flex items-center gap-1.5">
                                            <span className="font-medium">{Math.round((signal.confidence || 0) * 100)}%</span>
                                            <div className="w-12 h-1 bg-muted rounded-full overflow-hidden">
                                                <div 
                                                    className="h-full bg-primary transition-all"
                                                    style={{ width: `${(signal.confidence || 0) * 100}%` }}
                                                />
                                            </div>
                                        </div>
                                    </td>
                                    
                                    {/* R/R */}
                                    <td className="px-3 py-2 font-medium">{calculateRR(signal)}</td>
                                    
                                    {/* Time */}
                                    <td className="px-3 py-2 text-muted-foreground">{formatTime(signal)}</td>
                                    
                                    {/* Actions */}
                                    <td className="px-3 py-2">
                                        <div className="flex items-center gap-1">
                                            <QuickTradeButton
                                                signal={signal}
                                                onClick={handleQuickTrade}
                                                isOnCooldown={quickTradeCooldowns.has(signal.id)}
                                            />
                                            <button
                                                onClick={(e) => handleCopySignal(signal, e)}
                                                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-muted rounded transition-all"
                                                title="Copy signal"
                                            >
                                                {copiedId === signal.id ? (
                                                    <ExternalLink className="w-3 h-3 text-primary" />
                                                ) : (
                                                    <Copy className="w-3 h-3 text-muted-foreground" />
                                                )}
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
            </div>
            
            <style jsx>{`
                @property --rainbow-angle {
                    syntax: '<angle>';
                    initial-value: 0deg;
                    inherits: false;
                }

                @keyframes rainbow-spin {
                    to {
                        --rainbow-angle: 1turn;
                    }
                }

                .rainbow-card-wrapper {
                    position: relative;
                    border-radius: 0.5rem;
                }

                .rainbow-glow {
                    content: '';
                    position: absolute;
                    inset: -1em;
                    border: solid 1.1em;
                    border-image: conic-gradient(
                        from var(--rainbow-angle),
                        #669900,
                        #99cc33,
                        #ccee66,
                        #006699,
                        #3399cc,
                        #990066,
                        #cc3399,
                        #ff6600,
                        #ff9900,
                        #ffcc00,
                        #669900
                    ) 1;
                    filter: blur(1em);
                    animation: rainbow-spin 4s linear infinite;
                    pointer-events: none;
                    z-index: 0;
                    opacity: 0.5;
                }
            `}</style>
        </div>
    );
}
