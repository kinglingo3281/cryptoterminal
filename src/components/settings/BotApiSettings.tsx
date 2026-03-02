'use client'

/**
 * Bot API Settings Component
 * UI for generating and managing bot API tokens
 * Allows users to connect Moltbot/Clawdbot or any external bot
 */

import { useState, useEffect } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { Copy, Key, Trash2, Plus, Bot, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { BotTokenPermissions } from '@/types/bot-api'
import { toast } from 'sonner'

interface TokenListItem {
  id: string
  label: string | null
  permissions: BotTokenPermissions
  created_at: string
  expires_at: string | null
  last_used_at: string | null
  is_revoked: boolean
}

export function BotApiSettings() {
  const { getAccessToken, authenticated } = usePrivy()
  
  const [tokens, setTokens] = useState<TokenListItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  // New token form state
  const [showNewTokenForm, setShowNewTokenForm] = useState(false)
  const [newTokenLabel, setNewTokenLabel] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  
  // Generated token (shown once)
  const [generatedToken, setGeneratedToken] = useState<string | null>(null)
  const [tokenCopied, setTokenCopied] = useState(false)
  
  // Base URL for API
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://your-project.supabase.co'
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  
  // Fetch tokens on mount
  useEffect(() => {
    if (authenticated) {
      fetchTokens()
    }
  }, [authenticated])
  
  const fetchTokens = async (silent = false) => {
    if (!silent) {
      setIsLoading(true)
      setError(null)
    }
    
    try {
      const privyToken = await getAccessToken()
      
      const response = await fetch(`${supabaseUrl}/functions/v1/list-bot-tokens`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseAnonKey}`,
          'X-Privy-Token': privyToken || '',
          'Content-Type': 'application/json'
        }
      })
      
      const data = await response.json()
      
      if (data.success) {
        setTokens(data.data.tokens.filter((t: TokenListItem) => !t.is_revoked))
        setError(null) // Clear any previous errors on success
      } else if (!silent && data.error !== 'Token verification failed') {
        // Don't show token verification errors (usually rate limits)
        setError(data.error || 'Failed to fetch tokens')
      }
    } catch (err: any) {
      if (!silent) {
        setError(err.message || 'Failed to fetch tokens')
      }
    } finally {
      if (!silent) {
        setIsLoading(false)
      }
    }
  }
  
  const createToken = async () => {
    setIsCreating(true)
    setError(null)
    
    try {
      const privyToken = await getAccessToken()
      
      const response = await fetch(`${supabaseUrl}/functions/v1/create-bot-token`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseAnonKey}`,
          'X-Privy-Token': privyToken || '',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          label: newTokenLabel || undefined
        })
      })
      
      const data = await response.json()
      
      if (data.success && data.data.token) {
        setGeneratedToken(data.data.token)
        setNewTokenLabel('')
        setShowNewTokenForm(false)
        fetchTokens(true) // silent refresh
      } else {
        setError(data.error || 'Failed to create token')
      }
    } catch (err: any) {
      setError(err.message || 'Failed to create token')
    } finally {
      setIsCreating(false)
    }
  }
  
  const revokeToken = (tokenId: string) => {
    toast('Revoke this token?', {
      description: 'Any bots using it will lose access.',
      action: {
        label: 'Revoke',
        onClick: async () => {
          try {
            const privyToken = await getAccessToken()
            
            const response = await fetch(`${supabaseUrl}/functions/v1/revoke-bot-token`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${supabaseAnonKey}`,
                'X-Privy-Token': privyToken || '',
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ token_id: tokenId })
            })
            
            const data = await response.json()
            
            if (data.success) {
              setTokens(prev => prev.filter(t => t.id !== tokenId))
              fetchTokens(true)
              toast.success('Token revoked')
            } else {
              toast.error(data.error || 'Failed to revoke token')
            }
          } catch (err: any) {
            toast.error(err.message || 'Failed to revoke token')
          }
        }
      }
    })
  }
  
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    setTokenCopied(true)
    setTimeout(() => setTokenCopied(false), 2000)
  }
  
  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Never'
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }
  
  if (!authenticated) {
    return (
      <div className="p-4 border border-border rounded-lg bg-card">
        <p className="text-muted-foreground">Please login to manage Bot API tokens.</p>
      </div>
    )
  }
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-primary/10">
          <Bot className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h3 className="text-lg font-semibold">Bot API</h3>
          <p className="text-sm text-muted-foreground">
            Connect Moltbot, Clawdbot, or any trading bot to your account
          </p>
        </div>
      </div>
      
      {/* Error display */}
      {error && (
        <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}
      
      {/* Generated token display (shown once) */}
      {generatedToken && (
        <div className="p-4 border-2 border-primary rounded-lg bg-primary/5 space-y-4">
          <div className="flex items-center gap-2 text-primary font-medium">
            <CheckCircle className="w-5 h-5" />
            Token Created Successfully
          </div>
          
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              <strong>Copy this token now!</strong> It won't be shown again.
            </p>
            
            <div className="flex items-center gap-2">
              <code className="flex-1 p-3 bg-background border border-border rounded font-mono text-sm break-all">
                {generatedToken}
              </code>
              <button
                onClick={() => copyToClipboard(generatedToken)}
                className="p-2 hover:bg-muted rounded transition-colors"
                title="Copy token"
              >
                {tokenCopied ? (
                  <CheckCircle className="w-5 h-5 text-green-500" />
                ) : (
                  <Copy className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>
          
          <div className="pt-2 border-t border-border space-y-2">
            <p className="text-sm font-medium">API Base URL:</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 p-2 bg-background border border-border rounded font-mono text-sm">
                {baseUrl}/api/bot
              </code>
              <button
                onClick={() => copyToClipboard(`${baseUrl}/api/bot`)}
                className="p-2 hover:bg-muted rounded transition-colors"
              >
                <Copy className="w-4 h-4" />
              </button>
            </div>
          </div>
          
          <div className="pt-2 border-t border-border">
            <p className="text-sm font-medium mb-2">Example Usage:</p>
            <pre className="p-3 bg-background border border-border rounded text-xs overflow-x-auto">
{`# Get signals
curl -H "Authorization: Bearer ${generatedToken.slice(0, 8)}..." \\
  ${baseUrl}/api/bot/signals

# Execute trade
curl -X POST -H "Authorization: Bearer YOUR_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"signal_id": "abc123", "position_size": "2.5%"}' \\
  ${baseUrl}/api/bot/execute`}
            </pre>
          </div>
          
          <button
            onClick={() => setGeneratedToken(null)}
            className="w-full py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            I've Saved My Token
          </button>
        </div>
      )}
      
      {/* Token list */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="font-medium">Your Tokens</h4>
          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchTokens()}
              disabled={isLoading}
              className="p-2 hover:bg-muted rounded transition-colors"
              title="Refresh"
            >
              <RefreshCw className={cn("w-4 h-4", isLoading && "animate-spin")} />
            </button>
            <button
              onClick={() => setShowNewTokenForm(true)}
              disabled={tokens.length >= 5}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              New Token
            </button>
          </div>
        </div>
        
        {/* New token form */}
        {showNewTokenForm && (
          <div className="p-4 border border-border rounded-lg bg-card space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Token Label (optional)</label>
              <input
                type="text"
                value={newTokenLabel}
                onChange={(e) => setNewTokenLabel(e.target.value)}
                placeholder="e.g., Moltbot VPS"
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            
            <div className="flex items-center gap-2">
              <button
                onClick={createToken}
                disabled={isCreating}
                className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground text-sm rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {isCreating ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Key className="w-4 h-4" />
                    Generate Token
                  </>
                )}
              </button>
              <button
                onClick={() => {
                  setShowNewTokenForm(false)
                  setNewTokenLabel('')
                }}
                className="px-4 py-2 text-sm hover:bg-muted rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        
        {/* Token list */}
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : tokens.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Key className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No tokens yet. Create one to connect your bot.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {tokens.map((token) => (
              <div
                key={token.id}
                className="flex items-center justify-between p-3 border border-border rounded-lg bg-card hover:bg-muted/50 transition-colors"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Key className="w-4 h-4 text-muted-foreground" />
                    <span className="font-medium">
                      {token.label || 'Unnamed Token'}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Created: {formatDate(token.created_at)}
                    {token.last_used_at && (
                      <> · Last used: {formatDate(token.last_used_at)}</>
                    )}
                  </div>
                </div>
                
                <button
                  onClick={() => revokeToken(token.id)}
                  className="p-2 text-destructive hover:bg-destructive/10 rounded transition-colors"
                  title="Revoke token"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
        
        {tokens.length >= 5 && (
          <p className="text-sm text-muted-foreground">
            Maximum 5 tokens allowed. Revoke an existing token to create a new one.
          </p>
        )}
      </div>
      
      {/* API Documentation */}
      <div className="space-y-4 pt-4 border-t border-border">
        <h4 className="font-medium">API Endpoints</h4>
        
        <div className="grid gap-2 text-sm">
          <div className="flex items-center gap-2 p-2 bg-muted/50 rounded">
            <code className="px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded text-xs">GET</code>
            <code>/api/bot/signals</code>
            <span className="text-muted-foreground">- Get trade signals</span>
          </div>
          <div className="flex items-center gap-2 p-2 bg-muted/50 rounded">
            <code className="px-2 py-0.5 bg-green-500/20 text-green-400 rounded text-xs">POST</code>
            <code>/api/bot/execute</code>
            <span className="text-muted-foreground">- Execute trade from signal</span>
          </div>
          <div className="flex items-center gap-2 p-2 bg-muted/50 rounded">
            <code className="px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded text-xs">GET</code>
            <code>/api/bot/positions</code>
            <span className="text-muted-foreground">- Get open positions</span>
          </div>
          <div className="flex items-center gap-2 p-2 bg-muted/50 rounded">
            <code className="px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded text-xs">GET</code>
            <code>/api/bot/orders</code>
            <span className="text-muted-foreground">- Get open orders</span>
          </div>
          <div className="flex items-center gap-2 p-2 bg-muted/50 rounded">
            <code className="px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded text-xs">GET</code>
            <code>/api/bot/account</code>
            <span className="text-muted-foreground">- Get account summary</span>
          </div>
          <div className="flex items-center gap-2 p-2 bg-muted/50 rounded">
            <code className="px-2 py-0.5 bg-green-500/20 text-green-400 rounded text-xs">POST</code>
            <code>/api/bot/cancel</code>
            <span className="text-muted-foreground">- Cancel an order</span>
          </div>
          <div className="flex items-center gap-2 p-2 bg-muted/50 rounded">
            <code className="px-2 py-0.5 bg-green-500/20 text-green-400 rounded text-xs">POST</code>
            <code>/api/bot/close</code>
            <span className="text-muted-foreground">- Close a position</span>
          </div>
          <div className="flex items-center gap-2 p-2 bg-muted/50 rounded">
            <code className="px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded text-xs">GET</code>
            <code>/api/bot/history</code>
            <span className="text-muted-foreground">- Get trade history</span>
          </div>
        </div>
        
        <p className="text-xs text-muted-foreground">
          All endpoints require <code className="px-1 bg-muted rounded">Authorization: Bearer YOUR_TOKEN</code> header.
          Trades execute through your account with builder fees preserved.
        </p>
        
        <div className="mt-4 p-3 bg-primary/5 border border-primary/20 rounded-lg">
          <p className="text-xs text-primary font-medium mb-1">⚠️ Keep Browser Open</p>
          <p className="text-xs text-muted-foreground">
            Trade commands are sent to your browser for execution. Keep the app open for Clawdbot to work.
            Your API keys never leave the browser.
          </p>
        </div>
      </div>
    </div>
  )
}
