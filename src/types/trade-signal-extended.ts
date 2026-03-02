// Extended TradeSignal types for detail panel with enhanced data

export interface EnhancedTradeSignal extends BaseTradeSignal {
    // Current price (from live stream or API)
    current_price?: number;
    
    // Duration estimates
    tp_hours?: number;
    sl_hours?: number;
    duration_confidence?: number;
    
    // Range data
    tp_range?: string;
    sl_range?: string;
    
    // Enhanced cluster data from server
    enhanced_data?: EnhancedData;
    
    // Legacy cluster format (backward compatibility)
    clusters?: LegacyCluster[];
}

export interface BaseTradeSignal {
    id: string;
    asset: string;
    direction: 'long' | 'short';
    entry_price: number | string;
    target_price: number | string;
    stop_price: number | string;
    confidence: number;
    reward_risk?: number;
    signal_type?: string;
    file_timestamp?: string;
    created_at?: string;
    timestamp?: string;
}

export interface EnhancedData {
    summary?: SummaryData;
    clusters?: ClustersData;
}

export interface SummaryData {
    risk_assessment?: string;              // "Low" | "Medium" | "High"
    long_quality_score?: number;           // 0-1
    short_quality_score?: number;          // 0-1
    dominant_bias?: string;                // "Bullish" | "Bearish" | "Neutral"
    
    // Cascade probabilities
    long_cascade_probability?: number;     // 0-1
    short_cascade_probability?: number;    // 0-1
    overall_cascade_probability?: number;  // 0-1
    dominant_cascade_direction?: 'long' | 'short';
    directional_strength?: number;         // 0-1
    
    // Market context
    market_context?: MarketContext;
}

export interface MarketContext {
    trend?: {
        direction?: string;                // "Up" | "Down" | "Sideways"
    };
    volatility?: {
        atr_percent?: number;              // ATR as percentage
    };
    support_resistance?: {
        support_levels?: number[];         // Array of support prices
        resistance_levels?: number[];      // Array of resistance prices
    };
}

export interface ClustersData {
    long_clusters?: ClusterData[];
    short_clusters?: ClusterData[];
}

export interface ClusterData {
    direction: 'long' | 'short';
    center_price: number | string;         // Main cluster price
    total_size: number | string;           // Total position size in cluster
    position_count: number;                // Number of positions
    price_distance_pct?: number;           // % distance from current price
    composite_risk?: number;               // Risk score 0-10
    trigger_probability?: number;          // 0-1 probability of triggering
    price_range?: [number, number];        // [min, max] price range
    
    // Individual positions in cluster
    positions?: PositionData[];
}

export interface PositionData {
    trader?: string;                       // Trader address
    trader_address?: string;               // Alt field name
    price: number | string;                // Position liquidation price
    entry_price?: number | string;         // Position entry price
    size: number | string;                 // Position size (contracts)
    usd_size: number | string;             // USD value
    source?: string;                       // Data source
}

export interface LegacyCluster {
    cluster_type: string;
    center_price: number | string;
    total_size: number | string;
    position_count: number;
    positions?: PositionData[];
}

// Processed cluster for heatmap rendering
export interface ProcessedCluster {
    price: number;
    size: number;
    positions: number;
    isLong: boolean;
    type: string;
    color: string;
    priceDistancePct?: number;
    risk?: number;
}
