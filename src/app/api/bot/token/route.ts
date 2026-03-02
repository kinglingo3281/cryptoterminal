/**
 * Bot API - Token Management
 * POST /api/bot/token - Create a new bot token (requires Privy auth)
 * GET /api/bot/token - List user's tokens (requires Privy auth)
 * DELETE /api/bot/token - Revoke a token (requires Privy auth)
 */

import { NextRequest, NextResponse } from 'next/server'
import { BotAuthService } from '@/services/BotAuthService'
import type { 
  BotApiResponse, 
  CreateTokenRequest, 
  CreateTokenResponse,
  ListTokensResponse,
  RevokeTokenResponse
} from '@/types/bot-api'

export const dynamic = 'force-dynamic'

/**
 * Create a new bot token
 */
export async function POST(request: NextRequest): Promise<NextResponse<BotApiResponse<CreateTokenResponse>>> {
  try {
    // Get Privy token from header (browser auth)
    const privyToken = request.headers.get('x-privy-token')
    
    if (!privyToken) {
      return NextResponse.json(
        { success: false, error: 'Missing X-Privy-Token header. Please login first.' },
        { status: 401 }
      )
    }
    
    // Parse request body
    const body: CreateTokenRequest = await request.json().catch(() => ({}))
    
    // Generate token (BotAuthService.generateToken verifies the user internally)
    const result = await BotAuthService.generateToken('', privyToken, body)
    
    return NextResponse.json({
      success: true,
      data: {
        success: true,
        token: result.token,
        token_id: result.tokenId
      }
    })
    
  } catch (error: any) {
    console.error('[Bot API] POST /token error:', error)
    
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to create token' },
      { status: 500 }
    )
  }
}

/**
 * List user's bot tokens
 */
export async function GET(request: NextRequest): Promise<NextResponse<BotApiResponse<ListTokensResponse>>> {
  try {
    // Get Privy token from header
    const privyToken = request.headers.get('x-privy-token')
    
    if (!privyToken) {
      return NextResponse.json(
        { success: false, error: 'Missing X-Privy-Token header. Please login first.' },
        { status: 401 }
      )
    }
    
    // List tokens
    const tokens = await BotAuthService.listTokens(privyToken)
    
    // Remove sensitive fields
    const safeTokens = tokens.map(t => ({
      id: t.id,
      label: t.label,
      permissions: t.permissions,
      created_at: t.created_at,
      expires_at: t.expires_at,
      last_used_at: t.last_used_at,
      is_revoked: t.is_revoked
    }))
    
    return NextResponse.json({
      success: true,
      data: { tokens: safeTokens }
    })
    
  } catch (error: any) {
    console.error('[Bot API] GET /token error:', error)
    
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to list tokens' },
      { status: 500 }
    )
  }
}

/**
 * Revoke a bot token
 */
export async function DELETE(request: NextRequest): Promise<NextResponse<BotApiResponse<RevokeTokenResponse>>> {
  try {
    // Get Privy token from header
    const privyToken = request.headers.get('x-privy-token')
    
    if (!privyToken) {
      return NextResponse.json(
        { success: false, error: 'Missing X-Privy-Token header. Please login first.' },
        { status: 401 }
      )
    }
    
    // Get token ID from query params
    const tokenId = request.nextUrl.searchParams.get('token_id')
    
    if (!tokenId) {
      return NextResponse.json(
        { success: false, error: 'token_id query parameter is required' },
        { status: 400 }
      )
    }
    
    // Revoke token
    await BotAuthService.revokeToken(tokenId, privyToken)
    
    return NextResponse.json({
      success: true,
      data: { message: 'Token revoked successfully' }
    })
    
  } catch (error: any) {
    console.error('[Bot API] DELETE /token error:', error)
    
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to revoke token' },
      { status: 500 }
    )
  }
}
