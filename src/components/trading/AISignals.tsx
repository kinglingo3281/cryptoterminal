'use client';

import { TradeSignal } from '@/hooks/useTradeDataManager';
import { useSSEData } from '@/providers/SSEProvider';
import { TrendingUp, TrendingDown, Clock, Target, Shield, Activity, Copy, ExternalLink, ChevronDown } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';

interface AISignalsProps {
    onSignalClick?: (signal: TradeSignal) => void;
    embedded?: boolean;
}

export function AISignals({ onSignalClick, embedded = false }: AISignalsProps) {
    const { allTrades, isConnected, connectionState } = useSSEData();
    const [currentPage, setCurrentPage] = useState(1);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const tradesPerPage = 100;
    
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
    
    // Helper functions (defined before useMemo)
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
    
    // Get unique assets
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
            
            if (sortColumn === 'file_timestamp' || sortColumn === 'created_at') {
                valueA = new Date(valueA || 0).getTime();
                valueB = new Date(valueB || 0).getTime();
            }
            else if (sortColumn === 'confidence' || sortColumn === 'entry_price' || sortColumn === 'target_price' || sortColumn === 'stop_price') {
                valueA = parseFloat(valueA as any) || 0;
                valueB = parseFloat(valueB as any) || 0;
            }
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
    
    // Keep user on valid page when trades update
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
        <div className={`flex flex-col h-full ${embedded ? '' : 'bg-zinc-950 border border-zinc-800 rounded-lg'}`}>
            {/* Header with Filters */}
            <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-zinc-800 bg-zinc-900/50 text-xs">
                <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-green-500" />
                    <h2 className="text-sm font-semibold text-zinc-100">AI Trading Signals</h2>
                    <span className="px-2 py-0.5 text-xs font-medium bg-green-500/10 text-green-500 rounded-full">
                        {allTrades.length}
                    </span>
                    {totalPages > 1 && (
                        <div className="flex items-center gap-1.5">
                            <span className="text-xs text-zinc-500">Page {currentPage}/{totalPages}</span>
                            <button
                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                disabled={currentPage === 1}
                                className="px-2 py-0.5 text-xs hover:bg-zinc-800 rounded disabled:opacity-30 transition-colors"
                            >
                                ←
                            </button>
                            <button
                                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                disabled={currentPage === totalPages}
                                className="px-2 py-0.5 text-xs hover:bg-zinc-800 rounded disabled:opacity-30 transition-colors"
                            >
                                →
                            </button>
                        </div>
                    )}
                </div>

                {/* Filter Controls */}
                <select
                    value={filters.asset}
                    onChange={(e) => { setFilters(prev => ({ ...prev, asset: e.target.value })); setCurrentPage(1); }}
                    className="w-32 px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-xs hover:bg-zinc-800 transition-colors"
                >
                    <option value="">All Assets</option>
                    {uniqueAssets.map(asset => (
                        <option key={asset} value={asset}>{asset}</option>
                    ))}
                </select>

                <select
                    value={filters.direction}
                    onChange={(e) => { setFilters(prev => ({ ...prev, direction: e.target.value })); setCurrentPage(1); }}
                    className="w-28 px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-xs hover:bg-zinc-800 transition-colors"
                >
                    <option value="">All Directions</option>
                    <option value="long">Long</option>
                    <option value="short">Short</option>
                </select>

                <div className="relative group">
                    <button className="w-28 px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-xs hover:bg-zinc-800 transition-colors flex items-center gap-1">
                        Signal Type
                        <ChevronDown className="w-3 h-3" />
                    </button>
                    <div className="hidden group-hover:block absolute top-full left-0 mt-1 bg-zinc-900 border border-zinc-700 rounded shadow-lg z-10 min-w-[120px]">
                        {['standard', 'ta_based', 'ta_range', 'v3'].map(type => (
                            <label key={type} className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-800 cursor-pointer">
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
                    placeholder="Min Conf (0-1)"
                    min="0"
                    max="1"
                    step="0.1"
                    value={filters.minConfidence || ''}
                    onChange={(e) => { setFilters(prev => ({ ...prev, minConfidence: parseFloat(e.target.value) || 0 })); setCurrentPage(1); }}
                    className="w-32 px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-xs hover:bg-zinc-800 transition-colors"
                />

                <input
                    type="number"
                    placeholder="Min R/R"
                    min="0"
                    step="0.1"
                    value={filters.minRR || ''}
                    onChange={(e) => { setFilters(prev => ({ ...prev, minRR: parseFloat(e.target.value) || 0 })); setCurrentPage(1); }}
                    className="w-24 px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-xs hover:bg-zinc-800 transition-colors"
                />

                <input
                    type="text"
                    placeholder="Pos Size"
                    value={filters.positionSize}
                    onChange={(e) => setFilters(prev => ({ ...prev, positionSize: e.target.value }))}
                    className="w-24 px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-xs hover:bg-zinc-800 transition-colors"
                />
                
                {filteredTrades.length !== allTrades.length && (
                    <span className="text-zinc-500 text-xs">
                        Showing {filteredTrades.length} of {allTrades.length}
                    </span>
                )}

                <div className="ml-auto flex items-center gap-2">
                    <div className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs ${
                        isConnected 
                            ? 'bg-green-500/10 text-green-500' 
                            : 'bg-red-500/10 text-red-500'
                    }`}>
                        <div className={`w-1.5 h-1.5 rounded-full ${
                            isConnected ? 'bg-green-500' : 'bg-red-500'
                        } ${isConnected ? 'animate-pulse' : ''}`} />
                        {connectionState.charAt(0).toUpperCase() + connectionState.slice(1)}
                    </div>
                </div>
            </div>

            {/* Signals List */}
            <div className="flex-1 overflow-y-auto">
                {!isConnected && allTrades.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full p-8 text-center">
                        <Activity className="w-12 h-12 text-zinc-700 mb-4" />
                        <h3 className="text-sm font-medium text-zinc-400 mb-1">
                            Connecting to AI Signals...
                        </h3>
                        <p className="text-xs text-zinc-600">
                            Real-time signals will appear here once connected
                        </p>
                    </div>
                ) : allTrades.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full p-8 text-center">
                        <Activity className="w-12 h-12 text-zinc-700 mb-4" />
                        <h3 className="text-sm font-medium text-zinc-400 mb-1">
                            No Active Signals
                        </h3>
                        <p className="text-xs text-zinc-600">
                            New AI-powered signals will appear here in real-time
                        </p>
                    </div>
                ) : (
                    <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-zinc-900/95 backdrop-blur border-b border-zinc-800">
                            <tr>
                                <th onClick={() => handleSort('asset')} className="px-3 py-2 text-left font-medium cursor-pointer hover:bg-zinc-800 transition-colors">
                                    <div className="flex items-center gap-1">
                                        Asset
                                        {sortColumn === 'asset' && <span className="text-green-500">{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                                    </div>
                                </th>
                                <th onClick={() => handleSort('direction')} className="px-3 py-2 text-left font-medium cursor-pointer hover:bg-zinc-800 transition-colors">
                                    <div className="flex items-center gap-1">
                                        Direction
                                        {sortColumn === 'direction' && <span className="text-green-500">{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                                    </div>
                                </th>
                                <th onClick={() => handleSort('entry_price')} className="px-3 py-2 text-left font-medium cursor-pointer hover:bg-zinc-800 transition-colors">
                                    <div className="flex items-center gap-1">
                                        Entry
                                        {sortColumn === 'entry_price' && <span className="text-green-500">{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                                    </div>
                                </th>
                                <th onClick={() => handleSort('target_price')} className="px-3 py-2 text-left font-medium cursor-pointer hover:bg-zinc-800 transition-colors">
                                    <div className="flex items-center gap-1">
                                        Target
                                        {sortColumn === 'target_price' && <span className="text-green-500">{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                                    </div>
                                </th>
                                <th onClick={() => handleSort('stop_price')} className="px-3 py-2 text-left font-medium cursor-pointer hover:bg-zinc-800 transition-colors">
                                    <div className="flex items-center gap-1">
                                        Stop
                                        {sortColumn === 'stop_price' && <span className="text-green-500">{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                                    </div>
                                </th>
                                <th onClick={() => handleSort('confidence')} className="px-3 py-2 text-left font-medium cursor-pointer hover:bg-zinc-800 transition-colors">
                                    <div className="flex items-center gap-1">
                                        Conf
                                        {sortColumn === 'confidence' && <span className="text-green-500">{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                                    </div>
                                </th>
                                <th onClick={() => handleSort('risk_reward')} className="px-3 py-2 text-left font-medium cursor-pointer hover:bg-zinc-800 transition-colors">
                                    <div className="flex items-center gap-1">
                                        R/R
                                        {sortColumn === 'risk_reward' && <span className="text-green-500">{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                                    </div>
                                </th>
                                <th onClick={() => handleSort('file_timestamp')} className="px-3 py-2 text-left font-medium cursor-pointer hover:bg-zinc-800 transition-colors">
                                    <div className="flex items-center gap-1">
                                        Time
                                        {sortColumn === 'file_timestamp' && <span className="text-green-500">{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                                    </div>
                                </th>
                                <th className="px-3 py-2 text-left font-medium w-20">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {currentPageTrades.map((signal) => (
                                <tr
                                    key={signal.id}
                                    onClick={() => onSignalClick?.(signal)}
                                    className="border-b border-zinc-800 hover:bg-zinc-900/50 transition-colors cursor-pointer group"
                                >
                                    <td className="px-3 py-2">
                                        <div className="font-semibold text-zinc-100">{signal.asset}</div>
                                        {signal.signal_type && (
                                            <div className="text-[10px] text-blue-400">
                                                {getSignalTypeDisplay(signal.signal_type)}
                                            </div>
                                        )}
                                    </td>
                                    
                                    <td className="px-3 py-2">
                                        <div className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded ${
                                            signal.direction === 'long' ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'
                                        }`}>
                                            {signal.direction === 'long' ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                                            <span className="font-medium">{signal.direction.toUpperCase()}</span>
                                        </div>
                                    </td>
                                    
                                    <td className="px-3 py-2 font-mono text-zinc-300">${formatPrice(signal.entry_price)}</td>
                                    
                                    <td className="px-3 py-2 font-mono text-green-400">${formatPrice(signal.target_price)}</td>
                                    
                                    <td className="px-3 py-2 font-mono text-red-400">${formatPrice(signal.stop_price)}</td>
                                    
                                    <td className="px-3 py-2">
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium">{Math.round((signal.confidence || 0) * 100)}%</span>
                                            <div className="w-16 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                                                <div 
                                                    className="h-full bg-green-500 transition-all"
                                                    style={{ width: `${(signal.confidence || 0) * 100}%` }}
                                                />
                                            </div>
                                        </div>
                                    </td>
                                    
                                    <td className="px-3 py-2 font-medium text-zinc-300">{calculateRR(signal)}</td>
                                    
                                    <td className="px-3 py-2 text-zinc-500">{formatTime(signal)}</td>
                                    
                                    <td className="px-3 py-2">
                                        <button
                                            onClick={(e) => handleCopySignal(signal, e)}
                                            className="opacity-0 group-hover:opacity-100 p-1 hover:bg-zinc-800 rounded transition-all"
                                            title="Copy signal"
                                        >
                                            {copiedId === signal.id ? (
                                                <ExternalLink className="w-3.5 h-3.5 text-green-500" />
                                            ) : (
                                                <Copy className="w-3.5 h-3.5 text-zinc-500" />
                                            )}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
