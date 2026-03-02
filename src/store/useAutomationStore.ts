import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface LogEntry {
    id: string;
    timestamp: number;
    type: 'info' | 'success' | 'warning' | 'error' | 'trade';
    bot: 'system' | 'autotrade' | 'cancel' | 'sltp' | 'trailing' | 'mm';
    message: string;
}

export interface AutomationSettings {
    // Global
    autoTradeEnabled: boolean;
    activeMode: 'volume' | 'advanced';
    
    // Volume Mode
    positionSize: string;
    riskLevel: number;
    
    // Advanced Mode - Confidence
    confidenceEnabled: boolean;
    minConfidence: number;
    
    // Advanced Mode - Reward/Risk
    rrEnabled: boolean;
    minRR: number;
    maxRR: number;
    
    // Advanced Mode - Distance Filters
    tpDistanceEnabled: boolean;
    slDistanceEnabled: boolean;
    entryDistanceEnabled: boolean;
    minTpDistance: number;
    maxTpDistance: number;
    minSlDistance: number;
    maxSlDistance: number;
    minEntryDistance: number;
    maxEntryDistance: number;
    
    // Advanced Mode - Position Limits
    maxLongs: number;
    maxShorts: number;
    
    // Advanced Mode - Market Bias
    longBiasEnabled: boolean;
    shortBiasEnabled: boolean;
    longBias: number;
    shortBias: number;
    
    // Advanced Mode - Signal Types
    rangingEnabled: boolean;
    liquidityEnabled: boolean;
    enhancedEnabled: boolean;
    v3Enabled: boolean;
    
    // Advanced Mode - Order Sizing
    scaleUpSize: boolean;
    orderLayering: boolean;
    crossOrder: boolean;
    
    // Blacklist
    blacklistedAssets: string[];
    
    // Cancel Bot
    cancelBotEnabled: boolean;
    cancelTimeout: number;
    cancelLimitOnly: boolean;
    
    // SL/TP Bot (Position Defense)
    sltpBotEnabled: boolean;
    autoSlEnabled: boolean;
    autoTpEnabled: boolean;
    defaultSlPercent: number;
    defaultTpPercent: number;
    
    // Trailing SL Bot
    trailingSLEnabled: boolean;
    trailingProfitTrigger: number;
    trailingMode: 'breakeven' | 'atr' | 'percent';
    
    // MM Bot (StableCoin Market Maker)
    mmBotEnabled: boolean;
    mmPricingMode: 'fixed' | 'evalgo';
    mmPairSettings: {
        [symbol: string]: {
            enabled: boolean;
            balancePct: number | null;
            fixedValue: number | null;
            maxBid: number;
            minAsk: number;
        };
    };
    
    // Activity Log
    activityLog: LogEntry[];
}

interface AutomationStore extends AutomationSettings {
    // Actions
    setAutoTradeEnabled: (enabled: boolean) => void;
    setActiveMode: (mode: 'volume' | 'advanced') => void;
    setPositionSize: (size: string) => void;
    setRiskLevel: (level: number) => void;
    
    // Confidence
    setConfidenceEnabled: (enabled: boolean) => void;
    setMinConfidence: (value: number) => void;
    
    // Reward/Risk
    setRrEnabled: (enabled: boolean) => void;
    setMinRR: (value: number) => void;
    setMaxRR: (value: number) => void;
    
    // Distance Filters
    setTpDistanceEnabled: (enabled: boolean) => void;
    setSlDistanceEnabled: (enabled: boolean) => void;
    setEntryDistanceEnabled: (enabled: boolean) => void;
    setMinTpDistance: (value: number) => void;
    setMaxTpDistance: (value: number) => void;
    setMinSlDistance: (value: number) => void;
    setMaxSlDistance: (value: number) => void;
    setMinEntryDistance: (value: number) => void;
    setMaxEntryDistance: (value: number) => void;
    
    // Position Limits
    setMaxLongs: (value: number) => void;
    setMaxShorts: (value: number) => void;
    
    // Market Bias
    setLongBiasEnabled: (enabled: boolean) => void;
    setShortBiasEnabled: (enabled: boolean) => void;
    setLongBias: (value: number) => void;
    setShortBias: (value: number) => void;
    
    // Signal Types
    setRangingEnabled: (enabled: boolean) => void;
    setLiquidityEnabled: (enabled: boolean) => void;
    setEnhancedEnabled: (enabled: boolean) => void;
    setV3Enabled: (enabled: boolean) => void;
    
    // Order Sizing
    setScaleUpSize: (enabled: boolean) => void;
    setOrderLayering: (enabled: boolean) => void;
    setCrossOrder: (enabled: boolean) => void;
    
    // Blacklist
    addToBlacklist: (asset: string) => void;
    removeFromBlacklist: (asset: string) => void;
    setBlacklist: (assets: string[]) => void;
    clearBlacklist: () => void;
    
    // Cancel Bot
    setCancelBotEnabled: (enabled: boolean) => void;
    setCancelTimeout: (minutes: number) => void;
    setCancelLimitOnly: (enabled: boolean) => void;
    
    // SL/TP Bot (Position Defense)
    setSltpBotEnabled: (enabled: boolean) => void;
    setAutoSlEnabled: (enabled: boolean) => void;
    setAutoTpEnabled: (enabled: boolean) => void;
    setDefaultSlPercent: (percent: number) => void;
    setDefaultTpPercent: (percent: number) => void;
    
    // Trailing SL Bot
    setTrailingSLEnabled: (enabled: boolean) => void;
    setTrailingProfitTrigger: (percent: number) => void;
    setTrailingMode: (mode: 'breakeven' | 'atr' | 'percent') => void;
    
    // MM Bot
    setMmBotEnabled: (enabled: boolean) => void;
    setMmPricingMode: (mode: 'fixed' | 'evalgo') => void;
    setMmPairSetting: (symbol: string, settings: Partial<{ enabled: boolean; balancePct: number | null; fixedValue: number | null; maxBid: number; minAsk: number }>) => void;
    toggleMmPair: (symbol: string) => void;
    
    // Activity Log
    addLog: (entry: Omit<LogEntry, 'id' | 'timestamp'>) => void;
    clearLogs: () => void;
    
    // Bulk update
    updateSettings: (settings: Partial<AutomationSettings>) => void;
    resetToDefaults: () => void;
}

// Advanced mode defaults (matches reference hardModeSettings)
const advancedModeDefaults = {
    confidenceEnabled: false,
    minConfidence: 0.4,
    rrEnabled: false,
    minRR: 1.5,
    maxRR: 4.0,
    tpDistanceEnabled: false,
    slDistanceEnabled: false,
    entryDistanceEnabled: false,
    minTpDistance: 1.0,
    maxTpDistance: 10.0,
    minSlDistance: 0.5,
    maxSlDistance: 5.0,
    minEntryDistance: 0.1,
    maxEntryDistance: 3.0,
    maxLongs: 5,
    maxShorts: 5,
    rangingEnabled: true,
    liquidityEnabled: true,
    enhancedEnabled: true,
    v3Enabled: false,
    scaleUpSize: false,
    orderLayering: false,
    crossOrder: false,
    longBiasEnabled: false,
    shortBiasEnabled: false,
    longBias: 0,
    shortBias: 0,
};

// Volume mode risk level presets (1-5) - matches old codebase getRiskLevelSettings exactly
// Excludes cooldown settings only (not used in new codebase)
const riskLevelPresets: { [key: number]: Partial<AutomationSettings> } = {
    1: { // Safe - Conservative Trading
        maxLongs: 2, maxShorts: 2,
        confidenceEnabled: false,
        tpDistanceEnabled: true, minTpDistance: 1.0, maxTpDistance: 20.0,
        slDistanceEnabled: true, minSlDistance: 0.6, maxSlDistance: 10.0,
        entryDistanceEnabled: true, minEntryDistance: 0.5, maxEntryDistance: 10.0,
        rrEnabled: true, minRR: 1.0, maxRR: 5.0,
        rangingEnabled: true, liquidityEnabled: false, enhancedEnabled: false, v3Enabled: false,
        scaleUpSize: true, orderLayering: false, crossOrder: false,
        longBiasEnabled: true, shortBiasEnabled: true, longBias: -15, shortBias: -15,
    },
    2: { // Cautious - Low Risk
        maxLongs: 3, maxShorts: 3,
        confidenceEnabled: false,
        tpDistanceEnabled: true, minTpDistance: 0.8, maxTpDistance: 20.0,
        slDistanceEnabled: true, minSlDistance: 0.4, maxSlDistance: 10.0,
        entryDistanceEnabled: true, minEntryDistance: 0.3, maxEntryDistance: 10.0,
        rrEnabled: true, minRR: 0.75, maxRR: 5.0,
        rangingEnabled: true, liquidityEnabled: false, enhancedEnabled: false, v3Enabled: false,
        scaleUpSize: true, orderLayering: false, crossOrder: false,
        longBiasEnabled: true, shortBiasEnabled: true, longBias: -10, shortBias: -10,
    },
    3: { // Balanced - Moderate Risk (DEFAULT)
        maxLongs: 5, maxShorts: 5,
        confidenceEnabled: false,
        tpDistanceEnabled: true, minTpDistance: 0.6, maxTpDistance: 20.0,
        slDistanceEnabled: true, minSlDistance: 0.25, maxSlDistance: 10.0,
        entryDistanceEnabled: true, minEntryDistance: 0.2, maxEntryDistance: 10.0,
        rrEnabled: true, minRR: 0.50, maxRR: 5.0,
        rangingEnabled: false, liquidityEnabled: true, enhancedEnabled: true, v3Enabled: false,
        scaleUpSize: true, orderLayering: true, crossOrder: true,
        longBiasEnabled: true, shortBiasEnabled: true, longBias: 0, shortBias: 0,
    },
    4: { // Aggressive - High Risk
        maxLongs: 8, maxShorts: 8,
        confidenceEnabled: false,
        tpDistanceEnabled: true, minTpDistance: 0.4, maxTpDistance: 20.0,
        slDistanceEnabled: true, minSlDistance: 0.18, maxSlDistance: 10.0,
        entryDistanceEnabled: true, minEntryDistance: 0.12, maxEntryDistance: 10.0,
        rrEnabled: true, minRR: 0.25, maxRR: 5.0,
        rangingEnabled: false, liquidityEnabled: true, enhancedEnabled: true, v3Enabled: false,
        scaleUpSize: true, orderLayering: true, crossOrder: true,
        longBiasEnabled: true, shortBiasEnabled: true, longBias: 0, shortBias: 0,
    },
    5: { // Maximum - Extreme Risk
        maxLongs: 10, maxShorts: 10,
        confidenceEnabled: false,
        tpDistanceEnabled: true, minTpDistance: 0.3, maxTpDistance: 20.0,
        slDistanceEnabled: true, minSlDistance: 0.15, maxSlDistance: 10.0,
        entryDistanceEnabled: true, minEntryDistance: 0.1, maxEntryDistance: 10.0,
        rrEnabled: false, minRR: 0.0, maxRR: 5.0,
        rangingEnabled: false, liquidityEnabled: true, enhancedEnabled: true, v3Enabled: false,
        scaleUpSize: true, orderLayering: true, crossOrder: true,
        longBiasEnabled: true, shortBiasEnabled: true, longBias: 5, shortBias: 5,
    },
};

const defaultSettings: AutomationSettings = {
    autoTradeEnabled: false,
    activeMode: 'volume',
    positionSize: '2.5%',
    riskLevel: 3,
    // AutoTrade filters - Risk Level 3 (Balanced) defaults for volume mode
    maxLongs: 5,
    maxShorts: 5,
    tpDistanceEnabled: true,
    minTpDistance: 0.6,
    maxTpDistance: 20.0,
    slDistanceEnabled: true,
    minSlDistance: 0.25,
    maxSlDistance: 10.0,
    entryDistanceEnabled: true,
    minEntryDistance: 0.2,
    maxEntryDistance: 10.0,
    rangingEnabled: false,
    liquidityEnabled: true,
    enhancedEnabled: true,
    v3Enabled: false,
    scaleUpSize: true,
    orderLayering: true,
    crossOrder: true,
    longBiasEnabled: true,
    shortBiasEnabled: true,
    longBias: 0,
    shortBias: 0,
    // Confidence filter (Advanced mode only - Volume mode sets to false via presets)
    confidenceEnabled: false,
    minConfidence: 0.4,
    // R/R filter (shared)
    rrEnabled: true,
    minRR: 0.50,
    maxRR: 5.0,
    blacklistedAssets: [],
    // Cancel Bot
    cancelBotEnabled: false,
    cancelTimeout: 5,
    cancelLimitOnly: true,
    // SL/TP Bot (Position Defense)
    sltpBotEnabled: false,
    autoSlEnabled: true,
    autoTpEnabled: true,
    defaultSlPercent: 2.0,
    defaultTpPercent: 4.0,
    // Trailing SL Bot
    trailingSLEnabled: false,
    trailingProfitTrigger: 2.0,
    trailingMode: 'breakeven',
    // MM Bot (StableCoin Market Maker)
    mmBotEnabled: false,
    mmPricingMode: 'fixed',
    mmPairSettings: {
        '@230': { enabled: true, balancePct: 100, fixedValue: null, maxBid: 0.9999, minAsk: 1.0001 },
        '@150': { enabled: false, balancePct: 100, fixedValue: null, maxBid: 0.9999, minAsk: 1.0001 },
        '@166': { enabled: false, balancePct: 100, fixedValue: null, maxBid: 0.9999, minAsk: 1.0001 },
    },
    // Activity Log
    activityLog: [],
};

export const useAutomationStore = create<AutomationStore>()(
    persist(
        (set) => ({
            ...defaultSettings,
            
            // Global
            setAutoTradeEnabled: (enabled) => set({ autoTradeEnabled: enabled }),
            setActiveMode: (mode) => set((state) => {
                if (mode === 'volume') {
                    // Volume mode: apply risk level preset for current riskLevel
                    const preset = riskLevelPresets[state.riskLevel] || riskLevelPresets[3];
                    return {
                        ...state,
                        activeMode: mode,
                        ...preset,
                    };
                } else {
                    // Advanced mode: apply advanced defaults
                    return {
                        ...state,
                        activeMode: mode,
                        ...advancedModeDefaults,
                    };
                }
            }),
            setPositionSize: (size) => set({ positionSize: size }),
            setRiskLevel: (level) => set((state) => {
                if (state.activeMode === 'volume') {
                    // Volume mode: apply full preset for this risk level
                    const preset = riskLevelPresets[level] || riskLevelPresets[3];
                    return {
                        ...state,
                        riskLevel: level,
                        ...preset,
                    };
                } else {
                    // Advanced mode: just update the level number
                    return { ...state, riskLevel: level };
                }
            }),
            
            // Confidence
            setConfidenceEnabled: (enabled) => set({ confidenceEnabled: enabled }),
            setMinConfidence: (value) => set({ minConfidence: value }),
            
            // Reward/Risk
            setRrEnabled: (enabled) => set({ rrEnabled: enabled }),
            setMinRR: (value) => set({ minRR: value }),
            setMaxRR: (value) => set({ maxRR: value }),
            
            // Distance Filters
            setTpDistanceEnabled: (enabled) => set({ tpDistanceEnabled: enabled }),
            setSlDistanceEnabled: (enabled) => set({ slDistanceEnabled: enabled }),
            setEntryDistanceEnabled: (enabled) => set({ entryDistanceEnabled: enabled }),
            setMinTpDistance: (value) => set({ minTpDistance: value }),
            setMaxTpDistance: (value) => set({ maxTpDistance: value }),
            setMinSlDistance: (value) => set({ minSlDistance: value }),
            setMaxSlDistance: (value) => set({ maxSlDistance: value }),
            setMinEntryDistance: (value) => set({ minEntryDistance: value }),
            setMaxEntryDistance: (value) => set({ maxEntryDistance: value }),
            
            // Position Limits
            setMaxLongs: (value) => set({ maxLongs: value }),
            setMaxShorts: (value) => set({ maxShorts: value }),
            
            // Market Bias
            setLongBiasEnabled: (enabled) => set({ longBiasEnabled: enabled }),
            setShortBiasEnabled: (enabled) => set({ shortBiasEnabled: enabled }),
            setLongBias: (value) => set({ longBias: value }),
            setShortBias: (value) => set({ shortBias: value }),
            
            // Signal Types
            setRangingEnabled: (enabled) => set({ rangingEnabled: enabled }),
            setLiquidityEnabled: (enabled) => set({ liquidityEnabled: enabled }),
            setEnhancedEnabled: (enabled) => set({ enhancedEnabled: enabled }),
            setV3Enabled: (enabled) => set({ v3Enabled: enabled }),
            
            // Order Sizing
            setScaleUpSize: (enabled) => set({ scaleUpSize: enabled }),
            setOrderLayering: (enabled) => set({ orderLayering: enabled }),
            setCrossOrder: (enabled) => set({ crossOrder: enabled }),
            
            // Blacklist
            addToBlacklist: (asset) => set((state) => ({
                blacklistedAssets: state.blacklistedAssets.includes(asset) 
                    ? state.blacklistedAssets 
                    : [...state.blacklistedAssets, asset]
            })),
            removeFromBlacklist: (asset) => set((state) => ({
                blacklistedAssets: state.blacklistedAssets.filter(a => a !== asset)
            })),
            setBlacklist: (assets) => set({ blacklistedAssets: assets }),
            clearBlacklist: () => set({ blacklistedAssets: [] }),
            
            // Cancel Bot
            setCancelBotEnabled: (enabled) => set({ cancelBotEnabled: enabled }),
            setCancelTimeout: (minutes) => set({ cancelTimeout: minutes }),
            setCancelLimitOnly: (enabled) => set({ cancelLimitOnly: enabled }),
            
            // SL/TP Bot (Position Defense)
            setSltpBotEnabled: (enabled) => set({ sltpBotEnabled: enabled }),
            setAutoSlEnabled: (enabled) => set({ autoSlEnabled: enabled }),
            setAutoTpEnabled: (enabled) => set({ autoTpEnabled: enabled }),
            setDefaultSlPercent: (percent) => set({ defaultSlPercent: percent }),
            setDefaultTpPercent: (percent) => set({ defaultTpPercent: percent }),
            
            // Trailing SL Bot
            setTrailingSLEnabled: (enabled) => set({ trailingSLEnabled: enabled }),
            setTrailingProfitTrigger: (percent) => set({ trailingProfitTrigger: percent }),
            setTrailingMode: (mode) => set({ trailingMode: mode }),
            
            // MM Bot
            setMmBotEnabled: (enabled) => set({ mmBotEnabled: enabled }),
            setMmPricingMode: (mode) => set({ mmPricingMode: mode }),
            setMmPairSetting: (symbol, settings) => set((state) => ({
                mmPairSettings: {
                    ...state.mmPairSettings,
                    [symbol]: { ...state.mmPairSettings[symbol], ...settings }
                }
            })),
            toggleMmPair: (symbol) => set((state) => ({
                mmPairSettings: {
                    ...state.mmPairSettings,
                    [symbol]: {
                        ...state.mmPairSettings[symbol],
                        enabled: !state.mmPairSettings[symbol]?.enabled
                    }
                }
            })),
            
            // Activity Log
            addLog: (entry) => set((state) => ({
                activityLog: [
                    { ...entry, id: crypto.randomUUID(), timestamp: Date.now() },
                    ...state.activityLog.slice(0, 1999) // Keep 2000 entries max
                ]
            })),
            clearLogs: () => set({ activityLog: [] }),
            
            // Bulk update
            updateSettings: (settings) => set((state) => ({ ...state, ...settings })),
            resetToDefaults: () => set(defaultSettings),
        }),
        {
            name: 'automation-settings',
        }
    )
);
