import { create } from 'zustand';
import { Position, Order, AccountSummary } from '@/types/positions';
import { useChaseStore } from './useChaseStore';

interface PositionsStore {
  positions: Position[];
  orders: Order[];
  accountSummary: AccountSummary | null;
  isConnected: boolean;
  isUsingFallback: boolean;
  pollingInterval: number;
  lastUpdate: number;
  error: string | null;
  
  setPositions: (positions: Position[]) => void;
  setOrders: (orders: Order[]) => void;
  setAccountSummary: (summary: AccountSummary) => void;
  setConnected: (connected: boolean) => void;
  setFallbackMode: (isActive: boolean, interval: number) => void;
  setError: (error: string | null) => void;
  updateAll: (data: {
    positions?: Position[];
    orders?: Order[];
    accountSummary?: AccountSummary;
    connected?: boolean;
    queriedDexNames?: Set<string>;
  }) => void;
  reset: () => void;
}

// Helper to merge orders preserving row positions with DEX-aware selective merge
function mergeOrders(existingOrders: Order[], newOrders: Order[], queriedDexNames?: Set<string>): Order[] {
  if (existingOrders.length === 0) return newOrders;
  
  const chaseStore = useChaseStore.getState();
  const newOrderMap = new Map(newOrders.map(o => [o.oid, o]));
  const usedOids = new Set<number>();
  
  // First pass: keep orders from non-queried DEXs, update orders from queried DEXs
  const merged: Order[] = existingOrders.map(existing => {
    // If this order is from a DEX we didn't query this cycle, preserve it
    if (queriedDexNames && !queriedDexNames.has(existing.dex || 'main')) {
      return existing;
    }
    
    // Direct OID match
    const directMatch = newOrderMap.get(existing.oid);
    if (directMatch) {
      usedOids.add(directMatch.oid);
      return directMatch;
    }
    
    // Check if this order was modified by chase (OID changed)
    const chase = chaseStore.getChaseForOrder(String(existing.oid));
    if (chase && chase.currentOid) {
      const newOid = parseInt(chase.currentOid);
      const chaseMatch = newOrderMap.get(newOid);
      if (chaseMatch) {
        usedOids.add(chaseMatch.oid);
        return chaseMatch;
      }
    }
    
    // Order from a queried DEX no longer exists (filled/cancelled)
    return null;
  }).filter((o): o is Order => o !== null);
  
  // Second pass: add any genuinely new orders at the end
  newOrders.forEach(order => {
    if (!usedOids.has(order.oid)) {
      merged.push(order);
    }
  });
  
  return merged;
}

// Helper to merge positions with DEX-aware selective merge
function mergePositions(existingPositions: Position[], newPositions: Position[], queriedDexNames?: Set<string>): Position[] {
  if (existingPositions.length === 0) return newPositions;
  if (!queriedDexNames) return newPositions;
  
  // Keep positions from non-queried DEXs, replace positions from queried DEXs
  const preserved = existingPositions.filter(p => !queriedDexNames.has(p.dex || 'main'));
  return [...preserved, ...newPositions];
}

export const usePositionsStore = create<PositionsStore>((set) => ({
  positions: [],
  orders: [],
  accountSummary: null,
  isConnected: false,
  isUsingFallback: false,
  pollingInterval: 2000,
  lastUpdate: 0,
  error: null,
  
  setPositions: (positions) => set({ 
    positions, 
    lastUpdate: Date.now(),
    error: null 
  }),
  
  setOrders: (newOrders) => set((state) => ({ 
    orders: mergeOrders(state.orders, newOrders), 
    lastUpdate: Date.now(),
    error: null 
  })),
  
  setAccountSummary: (accountSummary) => set({ 
    accountSummary, 
    lastUpdate: Date.now() 
  }),
  
  setConnected: (isConnected) => set({ isConnected }),
  
  setFallbackMode: (isUsingFallback, pollingInterval) => set({ 
    isUsingFallback, 
    pollingInterval 
  }),
  
  setError: (error) => set({ error }),
  
  updateAll: (data) => set((state) => {
    const { queriedDexNames, ...rest } = data;
    return {
      ...state,
      ...rest,
      positions: data.positions ? mergePositions(state.positions, data.positions, queriedDexNames) : state.positions,
      orders: data.orders ? mergeOrders(state.orders, data.orders, queriedDexNames) : state.orders,
      lastUpdate: Date.now(),
      error: null
    };
  }),
  
  reset: () => set({
    positions: [],
    orders: [],
    accountSummary: null,
    isConnected: false,
    isUsingFallback: false,
    pollingInterval: 2000,
    lastUpdate: 0,
    error: null
  })
}));
