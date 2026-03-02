import { create } from 'zustand'
import type { TradeHistoryFill, TradeHistoryStats } from '@/types/trade-history'
import { TradeHistoryService } from '@/services/TradeHistoryService'

interface TradeHistoryStore {
  fills: TradeHistoryFill[]
  isLoading: boolean
  lastFetch: number | null
  stats: TradeHistoryStats | null
  
  setFills: (fills: TradeHistoryFill[]) => void
  addFills: (newFills: TradeHistoryFill[]) => void
  setLoading: (loading: boolean) => void
  updateStats: () => void
  clear: () => void
}

export const useTradeHistoryStore = create<TradeHistoryStore>((set, get) => ({
  fills: [],
  isLoading: false,
  lastFetch: null,
  stats: null,
  
  setFills: (fills) => {
    set({ fills, lastFetch: Date.now() })
  },
  
  addFills: (newFills) => {
    const merged = TradeHistoryService.mergeFills(newFills, get().fills)
    set({ fills: merged, lastFetch: Date.now() })
  },
  
  setLoading: (isLoading) => set({ isLoading }),
  
  updateStats: () => {
    const stats = TradeHistoryService.calculateStats(get().fills)
    set({ stats })
  },
  
  clear: () => set({ fills: [], stats: null, lastFetch: null })
}))
