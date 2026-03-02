import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatPrice(price: number): string {
  if (!price || price === 0) return '0.00'
  const num = parseFloat(String(price))
  if (isNaN(num)) return '0.00'

  const magnitude = Math.floor(Math.log10(Math.abs(num)))
  const precision = 6 - magnitude - 1

  if (precision < 0) {
    return num.toExponential(5)
  } else {
    const decimals = Math.max(2, Math.max(0, precision))
    return num.toFixed(decimals)
  }
}
