/**
 * KeepAliveService - Prevents browser from throttling/suspending the tab
 * Essential for bot commands to work when tab is in background
 * Also handles periodic memory cleanup
 */

import { useFundingStore } from '@/store/useFundingStore'
import { useTrackerStore } from '@/store/useTrackerStore'

class KeepAliveService {
  private intervalId: ReturnType<typeof setInterval> | null = null
  private cleanupIntervalId: ReturnType<typeof setInterval> | null = null
  private webLock: any = null
  private isActive = false
  private logToConsole = false

  private log(...args: unknown[]) {
    if (this.logToConsole) {
      console.log(...args)
    }
  }

  start() {
    if (this.isActive) return
    this.isActive = true

    this.log('[KeepAlive] Starting background keep-alive...')

    // Method 1: Web Locks API (best for preventing suspension)
    this.acquireWebLock()

    // Method 2: Regular interval to prevent throttling
    this.intervalId = setInterval(() => {
      // Minimal work to keep JS engine active
      const now = Date.now()
      if (document.hidden) {
        this.log(`[KeepAlive] Background tick at ${new Date(now).toISOString()}`)
      }
    }, 10000) // Every 10 seconds

    // Method 3: Visibility change handler
    document.addEventListener('visibilitychange', this.handleVisibilityChange)

    // Memory cleanup every 5 minutes
    this.cleanupIntervalId = setInterval(() => {
      this.runCleanup()
    }, 5 * 60 * 1000)

    this.log('[KeepAlive] Background keep-alive active')
  }

  private runCleanup() {
    this.log('[KeepAlive] Running memory cleanup...')
    
    // Clear stale funding data
    useFundingStore.getState().clearStaleData()
    
    // Clear stale tracker data
    useTrackerStore.getState().clearStaleData()
    
    // Force garbage collection hint (browser may ignore)
    if (typeof window !== 'undefined' && (window as any).gc) {
      (window as any).gc()
    }
  }

  stop() {
    if (!this.isActive) return
    this.isActive = false

    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId)
      this.cleanupIntervalId = null
    }

    document.removeEventListener('visibilitychange', this.handleVisibilityChange)
    this.releaseWebLock()

    this.log('[KeepAlive] Stopped')
  }

  private handleVisibilityChange = () => {
    if (document.hidden) {
      this.log('[KeepAlive] Tab went to background - keeping alive')
      // Re-acquire lock when going to background
      this.acquireWebLock()
    } else {
      this.log('[KeepAlive] Tab came to foreground')
    }
  }

  private async acquireWebLock() {
    if (typeof navigator === 'undefined' || !navigator.locks) {
      this.log('[KeepAlive] Web Locks API not available')
      return
    }

    try {
      // Request a lock that we hold indefinitely - prevents tab suspension
      navigator.locks.request('bot-keep-alive', { mode: 'exclusive' }, async (lock) => {
        this.webLock = lock
        this.log('[KeepAlive] Web Lock acquired')
        // Hold the lock forever by returning a promise that never resolves
        return new Promise(() => {})
      }).catch(() => {
        // Lock released or failed
      })
    } catch (error) {
      this.log('[KeepAlive] Web Lock error:', error)
    }
  }

  private releaseWebLock() {
    // Web Locks are automatically released when the promise resolves
    // We can't manually release, but stopping the service will clean up
    this.webLock = null
  }

  isRunning() {
    return this.isActive
  }
}

export const keepAliveService = new KeepAliveService()
