/**
 * Bot API - Check Command Status
 * GET /api/bot/command/[id] - Check status of a command
 * 
 * Clawdbot can poll this to see if browser executed the command
 */

import { NextRequest, NextResponse } from 'next/server'
import { BotAuthService } from '@/services/BotAuthService'
import type { BotApiResponse } from '@/types/bot-api'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<BotApiResponse<any>>> {
  try {
    // Validate bot token
    const authHeader = request.headers.get('authorization')
    const user = await BotAuthService.validateToken(authHeader)
    
    const { id: commandId } = await params
    
    // Fetch command from Supabase
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/bot_commands?id=eq.${commandId}&user_id=eq.${user.user_id}&select=*`,
      {
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
        }
      }
    )
    
    if (!response.ok) {
      throw new Error('Failed to fetch command')
    }
    
    const commands = await response.json()
    
    if (!commands || commands.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Command not found' },
        { status: 404 }
      )
    }
    
    const command = commands[0]
    
    return NextResponse.json({
      success: true,
      data: {
        id: command.id,
        command_type: command.command_type,
        status: command.status,
        result: command.result,
        created_at: command.created_at,
        executed_at: command.executed_at
      }
    })
    
  } catch (error: any) {
    console.error('[Bot API] GET /command/[id] error:', error)
    
    let statusCode = 500
    if (error.message.includes('Authorization') || error.message.includes('token')) {
      statusCode = 401
    }
    
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: statusCode }
    )
  }
}
