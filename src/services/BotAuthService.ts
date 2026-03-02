/**
 * Bot Auth Service
 * Handles bot token generation, hashing, and validation
 * 
 * Production-ready: Uses Supabase for persistent token storage
 * Tokens are hashed with SHA-256, raw token shown only once
 */

import crypto from 'crypto'
import type { 
  BotToken, 
  BotTokenPermissions, 
  ValidatedBotUser,
  CreateTokenRequest 
} from '@/types/bot-api'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const DEFAULT_PERMISSIONS: BotTokenPermissions = {
  read_signals: true,
  execute_trades: true,
  read_account: true,
  cancel_orders: true,
  close_positions: true
}

// Note: API keys are handled in browser - server just validates tokens and publishes commands

export class BotAuthService {
  /**
   * Supabase query helper with service role
   */
  private static async supabaseQuery(
    table: string,
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    params?: { select?: string; filter?: string; body?: any; id?: string }
  ): Promise<any> {
    let url = `${SUPABASE_URL}/rest/v1/${table}`
    
    if (params?.filter) {
      url += `?${params.filter}`
    }
    if (params?.select) {
      url += `${params.filter ? '&' : '?'}select=${params.select}`
    }
    
    const headers: Record<string, string> = {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'return=representation' : 'return=minimal'
    }
    
    const response = await fetch(url, {
      method,
      headers,
      body: params?.body ? JSON.stringify(params.body) : undefined
    })
    
    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Supabase error: ${error}`)
    }
    
    if (method === 'DELETE' || (method === 'PATCH' && !params?.body)) {
      return null
    }
    
    const text = await response.text()
    return text ? JSON.parse(text) : null
  }

  /**
   * Generate a new bot token for a user
   * Returns the raw token (shown once) and stores the hash in Supabase
   */
  static async generateToken(
    userId: string,
    privyToken: string,
    options: CreateTokenRequest = {}
  ): Promise<{ token: string; tokenId: string }> {
    // Verify user and get their API key
    const userData = await this.verifyPrivyAndGetUserData(privyToken)
    
    if (!userData.api_keys?.hyperliquid?.apiKey) {
      throw new Error('No Hyperliquid API key found. Please add one in Settings first.')
    }
    
    // Generate random 32-byte token
    const rawToken = crypto.randomBytes(32).toString('hex')
    
    // Hash the token for storage
    const tokenHash = this.hashToken(rawToken)
    
    // Calculate expiry if specified
    let expiresAt: string | null = null
    if (options.expires_in_days) {
      const expiry = new Date()
      expiry.setDate(expiry.getDate() + options.expires_in_days)
      expiresAt = expiry.toISOString()
    }
    
    // Merge permissions with defaults
    const permissions: BotTokenPermissions = {
      ...DEFAULT_PERMISSIONS,
      ...(options.permissions || {})
    }
    
    // Insert token into Supabase
    const result = await this.supabaseQuery('bot_tokens', 'POST', {
      body: {
        user_id: userData.user.privy_id,
        token_hash: tokenHash,
        label: options.label || null,
        permissions,
        expires_at: expiresAt
      }
    })
    
    const tokenId = result?.[0]?.id || crypto.randomBytes(16).toString('hex')
    
    console.log(`[BotAuth] Created token for user ${userData.user.privy_id}`)
    
    return {
      token: rawToken,
      tokenId
    }
  }
  
  /**
   * Validate a bot token from Authorization header
   * Returns user info if valid, throws if invalid
   */
  static async validateToken(authHeader: string | null): Promise<ValidatedBotUser> {
    if (!authHeader) {
      throw new Error('Missing Authorization header')
    }
    
    // Extract token from "Bearer <token>"
    const parts = authHeader.split(' ')
    if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
      throw new Error('Invalid Authorization header format. Use: Bearer <token>')
    }
    
    const rawToken = parts[1]
    if (!rawToken || rawToken.length < 32) {
      throw new Error('Invalid token format')
    }
    
    // Hash the incoming token
    const tokenHash = this.hashToken(rawToken)
    
    // Look up token in Supabase
    const tokens = await this.supabaseQuery('bot_tokens', 'GET', {
      filter: `token_hash=eq.${tokenHash}`,
      select: '*'
    })
    
    if (!tokens || tokens.length === 0) {
      throw new Error('Invalid token')
    }
    
    const token = tokens[0]
    
    // Check if revoked
    if (token.is_revoked) {
      throw new Error('Token has been revoked')
    }
    
    // Check expiry
    if (token.expires_at && new Date(token.expires_at) < new Date()) {
      throw new Error('Token has expired')
    }
    
    return {
      user_id: token.user_id,
      token_id: token.id,
      permissions: token.permissions
    }
  }
  
  /**
   * Get user's wallet address from Supabase
   * Used for read-only operations (positions, account, orders)
   * Does NOT return private keys - only public wallet address
   */
  static async getUserWalletAddress(userId: string): Promise<string> {
    // Fetch user from Supabase
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/users?privy_id=eq.${userId}&select=wallet_address`,
      {
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
        }
      }
    )
    
    if (!response.ok) {
      throw new Error('Failed to fetch user data')
    }
    
    const users = await response.json()
    if (!users || users.length === 0 || !users[0].wallet_address) {
      throw new Error('User wallet address not found')
    }
    
    return users[0].wallet_address
  }
  
  /**
   * List all tokens for a user
   */
  static async listTokens(privyToken: string): Promise<BotToken[]> {
    // Verify user
    const userData = await this.verifyPrivyAndGetUserData(privyToken)
    const userId = userData.user.privy_id
    
    // Fetch tokens from Supabase
    const tokens = await this.supabaseQuery('bot_tokens', 'GET', {
      filter: `user_id=eq.${userId}`,
      select: 'id,user_id,label,permissions,created_at,expires_at,last_used_at,is_revoked'
    })
    
    return (tokens || []).map((t: any) => ({
      id: t.id,
      user_id: t.user_id,
      token_hash: '***hidden***',
      label: t.label,
      permissions: t.permissions,
      created_at: t.created_at,
      expires_at: t.expires_at,
      last_used_at: t.last_used_at,
      is_revoked: t.is_revoked
    }))
  }
  
  /**
   * Revoke a token
   */
  static async revokeToken(tokenId: string, privyToken: string): Promise<void> {
    // Verify user
    const userData = await this.verifyPrivyAndGetUserData(privyToken)
    const userId = userData.user.privy_id
    
    // Update token in Supabase
    await fetch(`${SUPABASE_URL}/rest/v1/bot_tokens?id=eq.${tokenId}&user_id=eq.${userId}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ is_revoked: true })
    })
    
    console.log(`[BotAuth] Revoked token ${tokenId}`)
  }
  
  /**
   * Update last_used_at timestamp for a token (fire and forget)
   */
  static async updateLastUsed(tokenId: string): Promise<void> {
    try {
      fetch(`${SUPABASE_URL}/rest/v1/bot_tokens?id=eq.${tokenId}`, {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ last_used_at: new Date().toISOString() })
      })
    } catch (error) {
      // Non-critical - don't throw
    }
  }
  
  /**
   * Verify Privy token and get user data (uses existing Supabase function)
   */
  private static async verifyPrivyAndGetUserData(privyToken: string): Promise<{
    user: { id: string; privy_id: string; email?: string; wallet_address?: string }
    api_keys: { [key: string]: { apiKey: string; [key: string]: any } }
  }> {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/get-user-data`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'X-Privy-Token': privyToken,
        'Content-Type': 'application/json'
      }
    })
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || 'Failed to verify user')
    }
    
    return response.json()
  }
  
  /**
   * Hash a token using SHA-256
   */
  private static hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex')
  }
  
  /**
   * Check if user has a specific permission
   */
  static hasPermission(
    permissions: BotTokenPermissions,
    permission: keyof BotTokenPermissions
  ): boolean {
    return permissions[permission] === true
  }
}
