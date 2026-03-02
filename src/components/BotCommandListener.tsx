'use client'

/**
 * Bot Command Listener Component
 * Invisible component that listens for Clawdbot commands
 * Add to app layout to enable bot execution
 */

import { useEffect } from 'react'
import { useBotCommandListener } from '@/hooks/useBotCommandListener'
import { keepAliveService } from '@/services/KeepAliveService'

const LOG_BOT_COMMAND_LISTENER = false

const log = (...args: unknown[]) => {
  if (LOG_BOT_COMMAND_LISTENER) {
    console.log(...args)
  }
}

export function BotCommandListener() {
  const { isListening, isReady } = useBotCommandListener()

  // Start keep-alive when bot listener is active
  useEffect(() => {
    if (isListening) {
      log('[BotCommandListener] Active - listening for commands')
      keepAliveService.start()
    }
    
    return () => {
      keepAliveService.stop()
    }
  }, [isListening])

  // This component renders nothing - it just listens
  return null
}
