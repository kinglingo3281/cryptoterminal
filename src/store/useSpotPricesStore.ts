import { create } from 'zustand';

interface SpotPricesStore {
  prices: Record<string, number>;
  lastUpdate: number;
  isConnected: boolean;
  
  setPrices: (prices: Record<string, number>) => void;
  setConnected: (connected: boolean) => void;
  reset: () => void;
}

export const useSpotPricesStore = create<SpotPricesStore>((set) => ({
  prices: {},
  lastUpdate: 0,
  isConnected: false,
  
  setPrices: (prices) => set({ 
    prices, 
    lastUpdate: Date.now() 
  }),
  
  setConnected: (isConnected) => set({ isConnected }),
  
  reset: () => set({
    prices: {},
    lastUpdate: 0,
    isConnected: false
  })
}));
