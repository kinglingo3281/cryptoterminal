/**
 * Position Size Parser Utility
 * Supports both percentage (%) and fixed USD ($) position sizing
 * Supports both percentage and fixed USD sizing
 */

export interface PositionSizeResult {
  type: 'percentage' | 'usd'
  value: number
  raw: string
}

/**
 * Parse position size input - simple % vs $ logic
 * @param input - User input (e.g., "2.5%", "50")
 * @returns { type: 'percentage'|'usd', value: number, raw: string }
 * 
 * LOGIC:
 * - Contains % → percentage of account
 * - No % → dollar amount for margin
 */
export function parsePositionSize(input: string | number): PositionSizeResult {
  // Handle null/undefined
  if (input === null || input === undefined) {
    return { type: 'percentage', value: 2.5, raw: '2.5%' }
  }
  
  // If it's a number, treat as percentage (BACKWARD COMPATIBLE)
  if (typeof input === 'number') {
    return { type: 'percentage', value: input, raw: `${input}%` }
  }
  
  // Convert to string and trim, remove $ if present
  const str = String(input).trim().replace(/\$/g, '')
  
  // Empty string - default
  if (str === '') {
    return { type: 'percentage', value: 2.5, raw: '2.5%' }
  }
  
  // Check for % symbol
  if (str.includes('%')) {
    const numStr = str.replace(/%/g, '').trim()
    const value = parseFloat(numStr)
    
    if (isNaN(value) || value <= 0 || value > 100) {
      console.warn(`[PositionSizeParser] Invalid percentage: "${str}", defaulting to 2.5%`)
      return { type: 'percentage', value: 2.5, raw: '2.5%' }
    }
    
    return { type: 'percentage', value: value, raw: `${value}%` }
  }
  
  // No % symbol - treat as dollar margin amount
  const value = parseFloat(str)
  
  if (isNaN(value) || value <= 0) {
    console.warn(`[PositionSizeParser] Invalid input: "${str}", defaulting to 2.5%`)
    return { type: 'percentage', value: 2.5, raw: '2.5%' }
  }
  
  return { type: 'usd', value: value, raw: `$${value}` }
}
