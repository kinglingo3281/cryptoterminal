// Utility to display spot pair symbols as readable asset names
// Backend uses @230, @150, @166 - UI shows USDH/USDC, USDE/USDC, USDT0/USDC

const SPOT_DISPLAY_MAP: Record<string, string> = {
    '@230': 'USDH/USDC',
    '@150': 'USDE/USDC',
    '@166': 'USDT0/USDC'
}

/**
 * Convert spot symbol to display name for UI
 * @param symbol - Backend symbol (e.g., "@230")
 * @returns Display name (e.g., "USDH/USDC") or original if not found
 */
export function getSpotDisplayName(symbol: string): string {
    return SPOT_DISPLAY_MAP[symbol] || symbol
}

/**
 * Unified display name for any asset type: spot, HIP-3, or regular perp
 * - "@230" → "USDH/USDC"
 * - "lighter:BTC" → "BTC"
 * - "BTC" → "BTC"
 */
export function getAssetDisplayName(symbol: string): string {
    if (symbol in SPOT_DISPLAY_MAP) return SPOT_DISPLAY_MAP[symbol]
    if (symbol.includes(':')) return symbol.split(':').slice(1).join(':')
    return symbol
}

/**
 * Get a short DEX badge label for HIP-3 assets (e.g., "lighter" → "L")
 * Returns null for non-HIP-3 assets
 */
export function getHip3Badge(symbol: string): string | null {
    if (!symbol.includes(':')) return null
    const dex = symbol.split(':')[0]
    return dex.charAt(0).toUpperCase()
}

/**
 * Check if symbol is a spot asset (any @ prefixed pair, not just stablecoins)
 */
export function isSpotStablecoin(symbol: string): boolean {
    return symbol.startsWith('@')
}
