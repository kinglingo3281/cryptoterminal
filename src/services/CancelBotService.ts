/**
 * Cancel Bot Service
 * Monitors and cancels unfilled orders after timeout
 */
import * as hl from '@nktkas/hyperliquid'
import { toast } from 'sonner'

interface TrackedOrder {
    orderId: string
    oid: number
    cloid?: string | null
    asset: string
    side: string
    size: string
    limitPx: string
    placedAt: number
    originalTimestamp: number
}

class CancelBotServiceClass {
    private enabled = false
    private trackedOrders = new Map<string, TrackedOrder>()
    private monitorInterval: NodeJS.Timeout | null = null
    private cancelTimeoutMinutes = 5
    private limitOnly = true
    private checkIntervalMs = 5000 // Check every 5 seconds
    private infoClient: hl.InfoClient
    private exchClient: hl.ExchangeClient | null = null
    private userAddress: string | null = null
    private onLog: ((message: string, type: 'info' | 'success' | 'error') => void) | null = null
    private logToConsole = false

    constructor() {
        const transport = new hl.HttpTransport({ isTestnet: false })
        this.infoClient = new hl.InfoClient({ transport })
        this.loadSettings()
    }

    setLogCallback(callback: (message: string, type: 'info' | 'success' | 'error') => void) {
        this.onLog = callback
    }

    private log(message: string, type: 'info' | 'success' | 'error' = 'info') {
        if (this.onLog) {
            this.onLog(`[Cancel Bot] ${message}`, type)
        }
        if (this.logToConsole) {
            console.log(`[Cancel Bot] ${message}`)
        }
    }

    initialize(exchClient: hl.ExchangeClient, userAddress: string) {
        this.exchClient = exchClient
        this.userAddress = userAddress
        this.log(`Initialized for ${userAddress.slice(0, 8)}...`)
    }

    // Receive orders from global store (called by BotProvider)
    private globalOrders: any[] = []

    updateOrders(orders: any[]) {
        this.globalOrders = orders
    }

    enable() {
        if (this.enabled) return true
        this.enabled = true
        this.saveSettings()
        this.startMonitoring()
        this.log('Enabled', 'success')
        return true
    }

    disable() {
        if (!this.enabled) return true
        this.enabled = false
        this.saveSettings()
        this.stopMonitoring()
        this.log('Disabled', 'info')
        return true
    }

    isEnabled() {
        return this.enabled
    }

    updateSettings(settings: { cancelTimeoutMinutes?: number; limitOnly?: boolean }) {
        if (settings.cancelTimeoutMinutes !== undefined) {
            this.cancelTimeoutMinutes = settings.cancelTimeoutMinutes
        }
        if (settings.limitOnly !== undefined) {
            this.limitOnly = settings.limitOnly
        }
        this.saveSettings()
        this.log(`Settings updated: ${this.cancelTimeoutMinutes}min timeout, limitOnly=${this.limitOnly}`)
    }

    private startMonitoring() {
        if (this.monitorInterval) return
        this.log('Starting monitoring loop')
        this.checkOrders()
        this.monitorInterval = setInterval(() => this.checkOrders(), this.checkIntervalMs)
    }

    private stopMonitoring() {
        if (this.monitorInterval) {
            clearInterval(this.monitorInterval)
            this.monitorInterval = null
            this.log('Monitoring stopped')
        }
    }

    private async checkOrders() {
        if (!this.enabled || !this.exchClient || !this.userAddress) return

        try {
            // Use global orders from store (synced by BotProvider), fallback to API
            let openOrders: any[]
            
            if (this.globalOrders.length > 0) {
                openOrders = this.globalOrders
            } else {
                openOrders = await this.infoClient.openOrders({ user: this.userAddress })
                if (!openOrders || !Array.isArray(openOrders)) return
            }
            
            // Filter to ENTRY orders only (non-reduce-only, non-TP/SL, non-spot)
            // This ensures we only cancel perp entry orders, not position protection or spot orders
            const entryOrders = openOrders.filter((o: any) => {
                // Skip spot orders (start with @)
                if (o.coin?.startsWith('@')) return false
                // Skip reduce-only orders (TP/SL are reduce-only)
                if (o.reduceOnly) return false
                // Skip position TP/SL orders
                if (o.isPositionTpsl) return false
                // If limitOnly enabled, only track limit orders (check orderType if available)
                if (this.limitOnly) {
                    const orderType = o.orderType || 'Limit'
                    if (orderType !== 'Limit') return false
                }
                return true
            })

            // Update tracked orders
            const now = Date.now()
            const currentOids = new Set<string>()

            for (const order of entryOrders) {
                const orderId = String(order.oid)
                currentOids.add(orderId)

                if (!this.trackedOrders.has(orderId)) {
                    // Handle both store format (BUY/SELL/LONG/SHORT) and raw API format (A/B)
                    const side = order.side === 'A' ? 'SELL' : 
                                 order.side === 'B' ? 'BUY' : 
                                 order.side // Already parsed (BUY/SELL/LONG/SHORT)
                    const size = order.sz || order.size
                    const price = order.limitPx
                    
                    this.trackedOrders.set(orderId, {
                        orderId,
                        oid: order.oid,
                        cloid: order.cloid || null,
                        asset: order.coin,
                        side: String(side),
                        size: String(size),
                        limitPx: String(price),
                        placedAt: now,
                        originalTimestamp: order.timestamp || now
                    })
                    this.log(`Tracking entry order: ${order.coin} ${side} ${size} @ $${price}`)
                    this.saveTrackedOrders()
                }
            }

            // Remove orders no longer open
            let ordersChanged = false
            for (const orderId of this.trackedOrders.keys()) {
                if (!currentOids.has(orderId)) {
                    this.trackedOrders.delete(orderId)
                    ordersChanged = true
                }
            }
            
            // Save tracked orders if changed
            if (ordersChanged) {
                this.saveTrackedOrders()
            }

            // Check for orders to cancel
            const timeoutMs = this.cancelTimeoutMinutes * 60 * 1000
            for (const [orderId, orderData] of this.trackedOrders) {
                const age = now - orderData.originalTimestamp
                if (age >= timeoutMs) {
                    const ageMinutes = Math.floor(age / 60000)
                    this.log(`Order ${orderData.asset} exceeded ${this.cancelTimeoutMinutes}min timeout (${ageMinutes}min old)`)
                    await this.cancelOrder(orderData)
                }
            }

        } catch (error) {
            this.log(`Error checking orders: ${(error as Error).message}`, 'error')
        }
    }

    private async cancelOrder(orderData: TrackedOrder) {
        if (!this.exchClient) return false

        try {
            // Get asset index (HIP-3 aware: pass dex param and compute absolute index)
            const isHip3 = orderData.asset.includes(':')
            const dexParam = isHip3 ? orderData.asset.split(':')[0] : ''
            const meta = await (this.infoClient as any).meta(dexParam ? { dex: dexParam } : undefined)
            const relativeIndex = meta.universe.findIndex((a: any) => a.name === orderData.asset)
            if (relativeIndex === -1) {
                this.log(`Asset ${orderData.asset} not found in ${dexParam || 'main'} metadata`, 'error')
                return false
            }

            let assetIndex = relativeIndex
            if (isHip3) {
                const allDexs = await (this.infoClient as any).perpDexs()
                let dexPosition = -1
                for (let i = 0; i < allDexs.length; i++) {
                    if (allDexs[i] !== null && allDexs[i]?.name === dexParam) {
                        dexPosition = allDexs.slice(0, i).filter((d: any) => d !== null).length
                        break
                    }
                }
                if (dexPosition >= 0) {
                    assetIndex = relativeIndex + 110000 + (dexPosition * 10000)
                }
            }

            let result: any
            
            // Check if we should use CLOID (starts with 0x) or regular OID
            if (orderData.cloid && String(orderData.cloid).startsWith('0x')) {
                result = await this.exchClient.cancelByCloid({
                    cancels: [{ asset: assetIndex, cloid: orderData.cloid }]
                })
            } else {
                result = await this.exchClient.cancel({
                    cancels: [{ a: assetIndex, o: orderData.oid }]
                })
            }

            // Check response status (matches old codebase)
            const success = result?.response?.data?.statuses?.[0] === 'success'
            
            if (success) {
                this.trackedOrders.delete(orderData.orderId)
                this.log(`Cancelled ${orderData.asset} ${orderData.side} ${orderData.size} @ $${orderData.limitPx}`, 'success')
                toast.info('Order auto-cancelled', { description: `${orderData.asset} ${orderData.side} @ $${orderData.limitPx}` })
                return true
            } else {
                this.log(`Cancel failed for ${orderData.asset}: ${JSON.stringify(result?.response?.data?.statuses)}`, 'error')
                toast.error('Auto-cancel failed', { description: orderData.asset })
                return false
            }
        } catch (error) {
            this.log(`Error cancelling ${orderData.asset}: ${(error as Error).message}`, 'error')
            return false
        }
    }

    private saveSettings() {
        if (typeof window !== 'undefined') {
            const data = this.loadDataFromStorage()
            data.settings = {
                enabled: this.enabled,
                cancelTimeoutMinutes: this.cancelTimeoutMinutes,
                limitOnly: this.limitOnly
            }
            localStorage.setItem('cancelBotData', JSON.stringify(data))
        }
    }
    
    private saveTrackedOrders() {
        if (typeof window !== 'undefined') {
            const data = this.loadDataFromStorage()
            data.orders = Object.fromEntries(this.trackedOrders)
            localStorage.setItem('cancelBotData', JSON.stringify(data))
        }
    }
    
    private loadDataFromStorage(): { settings: any; orders: any } {
        if (typeof window === 'undefined') {
            return { settings: {}, orders: {} }
        }
        try {
            const stored = localStorage.getItem('cancelBotData')
            if (stored) {
                return JSON.parse(stored)
            }
        } catch (e) {
            // Ignore
        }
        return { settings: {}, orders: {} }
    }

    private loadSettings() {
        if (typeof window !== 'undefined') {
            const data = this.loadDataFromStorage()
            
            // Load settings
            if (data.settings) {
                this.cancelTimeoutMinutes = data.settings.cancelTimeoutMinutes || 5
                this.limitOnly = data.settings.limitOnly !== false
            }
            
            // Load tracked orders (persisted across page refreshes)
            if (data.orders) {
                this.trackedOrders = new Map(Object.entries(data.orders).map(([k, v]: [string, any]) => [k, v as TrackedOrder]))
            }
        }
    }

    getStatus() {
        return {
            enabled: this.enabled,
            trackedOrders: this.trackedOrders.size,
            cancelTimeoutMinutes: this.cancelTimeoutMinutes,
            limitOnly: this.limitOnly
        }
    }
}

export const CancelBotService = new CancelBotServiceClass()
