import { create } from 'zustand'
import { FundingPair, FundingAsset } from '@/types/funding'
import { FundingService } from '@/services/FundingService'

interface FundingStore {
  // Data
  pairs: FundingPair[]
  assets: FundingAsset[]
  countdown: string
  lastFetch: Date | null
  loading: boolean
  
  // Actions
  setPairs: (pairs: FundingPair[]) => void
  setAssets: (assets: FundingAsset[]) => void
  setCountdown: (countdown: string) => void
  setLastFetch: (date: Date) => void
  setLoading: (loading: boolean) => void
  updateAll: (data: { pairs: FundingPair[]; assets: FundingAsset[]; countdown: string }) => void
  
  // Fetch action - can be called from bot commands
  fetchFundingData: () => Promise<boolean>
  
  // Cleanup
  clearStaleData: () => void
  reset: () => void
}

export const useFundingStore = create<FundingStore>((set, get) => ({
  pairs: [],
  assets: [],
  countdown: '',
  lastFetch: null,
  loading: false,
  
  setPairs: (pairs) => set({ pairs }),
  setAssets: (assets) => set({ assets }),
  setCountdown: (countdown) => set({ countdown }),
  setLastFetch: (lastFetch) => set({ lastFetch }),
  setLoading: (loading) => set({ loading }),
  
  updateAll: (data) => set({
    pairs: data.pairs,
    assets: data.assets,
    countdown: data.countdown,
    lastFetch: new Date()
  }),
  
  // Fetch funding data directly - callable from bot commands
  fetchFundingData: async () => {
    const state = get()
    
    // If already loading, wait for it to complete (poll every 100ms for up to 5s)
    if (state.loading) {
      console.log('[FundingStore] Already loading, waiting...')
      for (let i = 0; i < 50; i++) {
        await new Promise(resolve => setTimeout(resolve, 100))
        const current = get()
        if (!current.loading && current.pairs.length > 0) {
          console.log('[FundingStore] Loading completed while waiting')
          return true
        }
      }
      return get().pairs.length > 0
    }
    
    set({ loading: true })
    try {
      console.log('[FundingStore] Bot triggered fetch...')
      const assets = await FundingService.fetchAllRates()
      const pairs = FundingService.calculatePairs(assets)
      const countdown = FundingService.getNextFundingCountdown()
      
      set({
        pairs,
        assets,
        countdown,
        lastFetch: new Date(),
        loading: false
      })
      
      console.log(`[FundingStore] Fetched ${pairs.length} pairs, ${assets.length} assets`)
      return pairs.length > 0
    } catch (error) {
      console.error('[FundingStore] Fetch error:', error)
      set({ loading: false })
      return false
    }
  },
  
  // Clear data older than 10 minutes
  clearStaleData: () => {
    const state = get()
    if (state.lastFetch) {
      const age = Date.now() - state.lastFetch.getTime()
      if (age > 10 * 60 * 1000) { // 10 minutes
        console.log('[FundingStore] Clearing stale data')
        set({ pairs: [], assets: [], lastFetch: null })
      }
    }
  },
  
  // Full reset
  reset: () => {
    set({
      pairs: [],
      assets: [],
      countdown: '',
      lastFetch: null,
      loading: false
    })
  }
}))
