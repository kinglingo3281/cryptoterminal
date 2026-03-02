'use client'

import { cn } from '@/lib/utils'
import type { PositionAlerts } from '@/store/useTrackerStore'
import { Bell, ExternalLink } from 'lucide-react'

interface PositionAlertsTableProps {
  positionAlerts?: PositionAlerts
  symbol: string
}

const formatVolume = (val: number) => {
  if (!val) return '$0'
  const abs = Math.abs(val)
  const sign = val < 0 ? '-' : ''
  if (abs >= 1000000) return `${sign}$${(abs / 1000000).toFixed(1)}M`
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}K`
  return `${sign}$${val.toFixed(0)}`
}

// holding_time from API is in HOURS (e.g. 0.367 = ~22min)
const formatHoldTime = (hours: number) => {
  if (!hours) return '0m'
  if (hours >= 24) return `${Math.floor(hours / 24)}d`
  if (hours >= 1) return `${Math.floor(hours)}h`
  return `${Math.floor(hours * 60)}m`
}

const formatPrice = (p: number) => {
  if (!p) return '$0.00'
  if (p >= 1000) return `$${p.toFixed(2)}`
  if (p >= 1) return `$${p.toFixed(4)}`
  return `$${p.toFixed(6)}`
}

export function PositionAlertsTable({ positionAlerts, symbol }: PositionAlertsTableProps) {
  if (!positionAlerts) {
    return (
      <div className="p-4 bg-muted/30 rounded-lg border border-border">
        <div className="flex items-center gap-2 mb-2">
          <Bell className="w-4 h-4 text-primary" />
          <span className="font-medium text-sm">Position Alerts</span>
        </div>
        <div className="text-sm text-muted-foreground text-center py-4">No position alerts</div>
      </div>
    )
  }

  const signal = positionAlerts.signal || 'NEUTRAL'
  const signalClass = signal.includes('BULLISH') ? 'text-primary' : signal.includes('BEARISH') ? 'text-destructive' : 'text-muted-foreground'
  const signalBgClass = signal.includes('BULLISH') ? 'bg-primary/10' : signal.includes('BEARISH') ? 'bg-destructive/10' : 'bg-muted'
  const alerts = positionAlerts.alerts || []

  return (
    <div className="overflow-hidden h-[420px] flex flex-col">
      {/* Alert Rows Table */}
      {alerts.length > 0 ? (
        <div className="overflow-x-auto flex-1 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-border bg-card">
                <th className="text-left py-1.5 px-2 text-muted-foreground font-medium">Wallet</th>
                <th className="text-left py-1.5 px-2 text-muted-foreground font-medium">Label</th>
                <th className="text-right py-1.5 px-2 text-muted-foreground font-medium">Time</th>
                <th className="text-left py-1.5 px-2 text-muted-foreground font-medium">Side</th>
                <th className="text-right py-1.5 px-2 text-muted-foreground font-medium">Size</th>
                <th className="text-right py-1.5 px-2 text-muted-foreground font-medium">Entry</th>
                <th className="text-right py-1.5 px-2 text-muted-foreground font-medium">Liq</th>
                <th className="text-left py-1.5 px-2 text-muted-foreground font-medium">Mode</th>
                <th className="text-right py-1.5 px-2 text-muted-foreground font-medium">Balance</th>
                <th className="text-right py-1.5 px-2 text-muted-foreground font-medium">PnL</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((alert: any, idx) => {
                const a = alert
                const wallet = a.wallet || ''
                const type = a.type || ''
                const label = a.label || ''
                const side = a.side || ''
                const entry = parseFloat(a.entry || 0)
                const liq = parseFloat(a.liq_px || 0)
                const sizeUsd = Math.abs(parseFloat(a.delta || a.notional || 0))
                const balance = parseFloat(a.balance || 0)
                const pnl = parseFloat(a.pos_pnl || a.pnl || 0)
                // holding_time is in HOURS from API
                const holdHours = parseFloat(a.holding_time || 0)
                const mode = a.margin_mode || 'CROSS'
                const sym = a.coin || ''
                return (
                  <tr key={`${wallet}-${idx}`} className="border-b border-border/30 hover:bg-muted/30">
                    <td className="py-1.5 px-2">
                      <div className="flex items-center gap-1">
                        {type && (
                          <span className="px-1 py-0.5 bg-warning/20 text-warning text-[10px] rounded font-bold">{type}</span>
                        )}
                        <a
                          href={`https://hypurrscan.io/address/${wallet}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline flex items-center gap-0.5"
                        >
                          {wallet?.slice(0, 6)}..{wallet?.slice(-3)}
                          <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      </div>
                    </td>
                    <td className="py-1.5 px-2">
                      <span className="px-1.5 py-0.5 bg-muted rounded text-muted-foreground">{label || '—'}</span>
                    </td>
                    <td className="py-1.5 px-2 text-right text-muted-foreground">{formatHoldTime(holdHours)}</td>
                    <td className={cn("py-1.5 px-2", side === 'LONG' ? 'text-primary' : 'text-destructive')}>
                      {side || '—'}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono">{formatVolume(sizeUsd)}</td>
                    <td className="py-1.5 px-2 text-right font-mono">{formatPrice(entry)}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-destructive">{formatPrice(liq)}</td>
                    <td className="py-1.5 px-2 text-muted-foreground">{mode}</td>
                    <td className="py-1.5 px-2 text-right font-mono">{formatVolume(balance)}</td>
                    <td className={cn("py-1.5 px-2 text-right font-mono", pnl >= 0 ? 'text-primary' : 'text-destructive')}>
                      {pnl >= 0 ? '+' : ''}{formatVolume(pnl)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="px-4 py-3 text-xs text-muted-foreground text-center">No individual alerts available</div>
      )}

    </div>
  )
}
