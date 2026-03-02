'use client'

/**
 * Signal Request Listener Component
 * Mounts the signal request listener hook
 */

import { useSignalRequestListener } from '@/hooks/useSignalRequestListener'

export function SignalRequestListener() {
  const { isListening, signalCount } = useSignalRequestListener()
  
  // Silent component - no UI, just runs the hook
  // Uncomment for debugging:
  // console.log('[SignalRequestListener] Active:', isListening, 'Signals available:', signalCount)
  
  return null
}
