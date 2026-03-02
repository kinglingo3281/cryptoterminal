import { create } from 'zustand'

interface OrderbookPriceStore {
  selectedPrice: string | null
  setSelectedPrice: (price: string) => void
  clearSelectedPrice: () => void
}

export const useOrderbookPriceStore = create<OrderbookPriceStore>((set) => ({
  selectedPrice: null,
  setSelectedPrice: (price) => set({ selectedPrice: price }),
  clearSelectedPrice: () => set({ selectedPrice: null }),
}))
