"use client"

import { useState, useEffect, useCallback, useRef } from 'react'
import { FundingPair } from '@/types/funding'
import { FundingService } from '@/services/FundingService'
import { useFundingStore } from '@/store/useFundingStore'

export function useFundingRates() {
  const [pairs, setPairs] = useState<FundingPair[]>([])
  const [loading, setLoading] = useState(false)
  const [lastFetch, setLastFetch] = useState<Date | null>(null)
  const [countdown, setCountdown] = useState('')
  const isFetchingRef = useRef(false)
  
  // Get store actions
  const { updateAll, setLoading: setStoreLoading, setCountdown: setStoreCountdown } = useFundingStore()

  const fetchFundingRates = useCallback(async () => {
    if (isFetchingRef.current) return

    isFetchingRef.current = true
    setLoading(true)
    setStoreLoading(true)
    try {
      const assets = await FundingService.fetchAllRates()
      const calculatedPairs = FundingService.calculatePairs(assets)
      setPairs(calculatedPairs)
      setLastFetch(new Date())
      
      // Update global store so bot can access
      const currentCountdown = FundingService.getNextFundingCountdown()
      updateAll({ pairs: calculatedPairs, assets, countdown: currentCountdown })
      
      console.log(`[useFundingRates] Fetched ${calculatedPairs.length} pairs, ${assets.length} assets`)
    } catch (error) {
      console.error('[useFundingRates] Error:', error)
    } finally {
      setLoading(false)
      setStoreLoading(false)
      isFetchingRef.current = false
    }
  }, [updateAll, setStoreLoading])

  useEffect(() => {
    fetchFundingRates()

    const interval = setInterval(() => {
      fetchFundingRates()
    }, 300000)

    return () => clearInterval(interval)
  }, [fetchFundingRates])

  useEffect(() => {
    const updateCountdown = () => {
      setCountdown(FundingService.getNextFundingCountdown())
    }

    updateCountdown()
    const interval = setInterval(updateCountdown, 1000)

    return () => clearInterval(interval)
  }, [])

  return {
    pairs,
    loading,
    lastFetch,
    countdown,
    refresh: fetchFundingRates
  }
}
