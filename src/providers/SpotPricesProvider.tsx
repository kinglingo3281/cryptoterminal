"use client"

import { useSpotPricesWebSocket } from '@/hooks/useSpotPricesWebSocket';

interface SpotPricesProviderProps {
  children: React.ReactNode;
}

export function SpotPricesProvider({ children }: SpotPricesProviderProps) {
  useSpotPricesWebSocket();
  return <>{children}</>;
}
