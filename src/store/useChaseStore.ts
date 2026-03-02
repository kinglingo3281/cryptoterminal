import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ChaseData, ChaseSettings } from '@/types/chase'

interface ChaseState {
  // State
  activeChases: Map<string, ChaseData>
  chaseHistory: ChaseData[]
  
  // Actions
  addChase: (chase: ChaseData) => void
  updateChase: (chaseId: string, updates: Partial<ChaseData>) => void
  removeChase: (chaseId: string) => void
  moveToHistory: (chaseId: string) => void
  
  // Selectors
  getChaseForOrder: (orderId: string) => ChaseData | null
  getActiveChasesForAsset: (asset: string) => ChaseData[]
  isOrderChased: (orderId: string) => boolean
  
  // Persistence
  _hydrated: boolean
  _setHydrated: (val: boolean) => void
}

export const useChaseStore = create<ChaseState>()(
  persist(
    (set, get) => ({
      activeChases: new Map(),
      chaseHistory: [],
      _hydrated: false,
      
      addChase: (chase) => set((state) => {
        const newMap = new Map(state.activeChases)
        newMap.set(chase.chaseId, chase)
        return { activeChases: newMap }
      }),
      
      updateChase: (chaseId, updates) => set((state) => {
        const newMap = new Map(state.activeChases)
        const existing = newMap.get(chaseId)
        if (existing) {
          newMap.set(chaseId, { ...existing, ...updates })
        }
        return { activeChases: newMap }
      }),
      
      removeChase: (chaseId) => set((state) => {
        const newMap = new Map(state.activeChases)
        newMap.delete(chaseId)
        return { activeChases: newMap }
      }),
      
      moveToHistory: (chaseId) => set((state) => {
        const chase = state.activeChases.get(chaseId)
        if (!chase) return state
        
        const newMap = new Map(state.activeChases)
        newMap.delete(chaseId)
        
        return {
          activeChases: newMap,
          chaseHistory: [...state.chaseHistory, chase].slice(-50) // Keep last 50
        }
      }),
      
      getChaseForOrder: (orderId) => {
        const chases = Array.from(get().activeChases.values())
        
        // Strategy 1: Exact current OID match
        let found = chases.find(c => c.currentOid === orderId)
        if (found) return found
        
        // Strategy 2: Historical OID match
        found = chases.find(c => c.oidHistory.includes(orderId))
        if (found) return found
        
        return null
      },
      
      getActiveChasesForAsset: (asset) => {
        return Array.from(get().activeChases.values())
          .filter(c => c.asset === asset && c.status === 'active')
      },
      
      isOrderChased: (orderId) => {
        return get().getChaseForOrder(orderId) !== null
      },
      
      _setHydrated: (val) => set({ _hydrated: val })
    }),
    {
      name: 'chase-storage',
      partialize: (state) => ({
        activeChases: Array.from(state.activeChases.entries()),
        chaseHistory: state.chaseHistory
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Convert array back to Map
          state.activeChases = new Map(state.activeChases as any)
          state._setHydrated(true)
        }
      }
    }
  )
)
