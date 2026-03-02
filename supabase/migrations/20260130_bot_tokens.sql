-- Bot API Tables
-- Run this in Supabase SQL Editor

-- ============================================================================
-- Bot Tokens Table (for authentication)
-- ============================================================================
CREATE TABLE IF NOT EXISTS bot_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT,
  permissions JSONB DEFAULT '{"read_signals":true,"execute_trades":true,"read_account":true,"cancel_orders":true,"close_positions":true}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  is_revoked BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_bot_tokens_hash ON bot_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_bot_tokens_user ON bot_tokens(user_id);

ALTER TABLE bot_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON bot_tokens FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON bot_tokens TO service_role;

-- ============================================================================
-- Bot Commands Table (for realtime - Clawdbot publishes, browser listens)
-- ============================================================================
CREATE TABLE IF NOT EXISTS bot_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  command_type TEXT NOT NULL, -- 'execute', 'order', 'cancel', 'close'
  payload JSONB NOT NULL,
  status TEXT DEFAULT 'pending', -- 'pending', 'received', 'executed', 'failed'
  result JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  executed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_bot_commands_user ON bot_commands(user_id);
CREATE INDEX IF NOT EXISTS idx_bot_commands_user_pending ON bot_commands(user_id, status) WHERE status = 'pending';

ALTER TABLE bot_commands ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON bot_commands FOR ALL USING (true) WITH CHECK (true);
GRANT ALL ON bot_commands TO service_role;

-- Enable realtime for bot_commands table
ALTER PUBLICATION supabase_realtime ADD TABLE bot_commands;
