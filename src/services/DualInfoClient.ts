import * as hl from '@nktkas/hyperliquid';

/**
 * DualInfoClient - Transparent routing wrapper for InfoClient
 * Routes current state queries to remote node, historical to public API
 * 
 * Dynamic Polling Feature:
 * - When remote node fails, isUsingFallback becomes true
 * - Consumers should poll at 15s instead of 2s when isUsingFallback is true
 * - Health check runs every 30s to detect remote node recovery
 * - When remote recovers, isUsingFallback becomes false and consumers resume 2s polling
 */
export class DualInfoClient {
    private publicClient: hl.InfoClient;
    private remoteClient: hl.InfoClient | null;
    private useRemote: boolean = false;
    private stats = { remote: 0, public: 0, fallbacks: 0 };
    private suppressErrors: boolean = true;
    
    private isUsingFallback: boolean = false;
    private fallbackListeners: Set<(isUsingFallback: boolean, interval: number) => void> = new Set();
    private healthCheckInterval: NodeJS.Timeout | null = null;
    private consecutiveFailures: number = 0;
    private readonly FAILURE_THRESHOLD = 2;
    
    constructor(
        publicClient: hl.InfoClient,
        remoteClient: hl.InfoClient | null = null,
        useRemote: boolean = false,
        suppressErrors: boolean = true
    ) {
        this.publicClient = publicClient;
        this.remoteClient = remoteClient;
        this.useRemote = useRemote;
        this.suppressErrors = suppressErrors;
        // Start with fallback = false, only enter fallback when remote fails
        // If no remote configured, just use public with normal 2s polling
        this.isUsingFallback = false;
        
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('[DUAL-INFO-CLIENT] 🚀 Initializing...');
        if (remoteClient && useRemote) {
            console.log('[DUAL-INFO-CLIENT] ✅ Mode: PRIVATE NODE (with public fallback)');
            console.log('[DUAL-INFO-CLIENT] 📊 Primary: Private Node (2s polling)');
            console.log('[DUAL-INFO-CLIENT] 🔄 Backup: Public API (15s polling + WS)');
        } else if (remoteClient && !useRemote) {
            console.log('[DUAL-INFO-CLIENT] ⚠️  Mode: FALLBACK (starting with public)');
            console.log('[DUAL-INFO-CLIENT] 📊 Using: Public API (15s polling + WS)');
        } else {
            console.log('[DUAL-INFO-CLIENT] 🌐 Mode: PUBLIC API ONLY');
            console.log('[DUAL-INFO-CLIENT] 📊 Using: Public API (2s polling)');
        }
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        
        this.setupRoutingMethods();
        
        if (this.remoteClient) {
            this.startHealthCheck();
        }
    }
    
    private setupRoutingMethods() {
        // Current state queries → REMOTE NODE (with fallback)
        const remoteNodeMethods = [
            'clearinghouseState',
            'spotClearinghouseState',
            'openOrders',
            'meta',
            'perpDexs',
            'spotMeta',
            'exchangeStatus',
            'maxBuilderFee'
        ];
        
        // Historical data → PUBLIC API (always)
        const publicApiMethods = [
            'l2Book',
            'allMids',
            'candleSnapshot',
            'userFillsByTime',
            'referral'
        ];
        
        // Create routing methods for remote node queries
        remoteNodeMethods.forEach(method => {
            (this as any)[method] = async (...args: any[]) => {
                const startTime = Date.now();
                
                // When in fallback mode, skip remote and use public directly
                if (this.isUsingFallback && this.publicClient) {
                    try {
                        const result = await (this.publicClient as any)[method](...args);
                        const duration = Date.now() - startTime;
                        this.stats.public++;
                        return result;
                    } catch (error) {
                        if (!this.suppressErrors) {
                            console.error(`[DUAL-INFO-CLIENT] ${method}() failed on PUBLIC API (fallback mode)`);
                        }
                        throw error;
                    }
                }
                
                const source = this.useRemote ? 'REMOTE NODE' : 'PUBLIC API';
                
                try {
                    const client = this.useRemote ? this.remoteClient : this.publicClient;
                    const result = await (client as any)[method](...args);
                    const duration = Date.now() - startTime;
                    
                    if (this.useRemote) {
                        this.stats.remote++;
                        this.consecutiveFailures = 0;
                    } else {
                        this.stats.public++;
                    }
                    
                    return result;
                } catch (error) {
                    const duration = Date.now() - startTime;
                    if (!this.suppressErrors) {
                        console.error(`[DUAL-INFO-CLIENT] ${method}() failed on ${source} (${duration}ms)`);
                    }
                    
                    // Fallback to public API if remote fails
                    if (this.useRemote && this.publicClient) {
                        this.consecutiveFailures++;
                        this.stats.fallbacks++;
                        if (!this.suppressErrors) {
                            console.warn(`[DUAL-INFO-CLIENT] Falling back to PUBLIC API for ${method}()... (failure #${this.consecutiveFailures})`);
                        }
                        
                        // Enter fallback mode after threshold consecutive failures
                        if (this.consecutiveFailures >= this.FAILURE_THRESHOLD && !this.isUsingFallback) {
                            this.enterFallbackMode();
                        }
                        
                        try {
                            const fallbackStart = Date.now();
                            const result = await (this.publicClient as any)[method](...args);
                            const fallbackDuration = Date.now() - fallbackStart;
                            
                            this.stats.public++;
                            return result;
                        } catch (fallbackError) {
                            if (!this.suppressErrors) {
                                console.error(`[DUAL-INFO-CLIENT] ${method}() fallback FAILED on PUBLIC API`);
                            }
                            throw fallbackError;
                        }
                    }
                    throw error;
                }
            };
        });
        
        // Create methods that ALWAYS use public API
        publicApiMethods.forEach(method => {
            (this as any)[method] = async (...args: any[]) => {
                const startTime = Date.now();
                
                try {
                    const result = await (this.publicClient as any)[method](...args);
                    const duration = Date.now() - startTime;
                    this.stats.public++;
                    return result;
                } catch (error) {
                    const duration = Date.now() - startTime;
                    if (!this.suppressErrors) {
                        console.error(`[DUAL-INFO-CLIENT] ${method}() failed on PUBLIC API (${duration}ms)`);
                    }
                    throw error;
                }
            };
        });
    }
    
    async healthCheck() {
        if (!this.useRemote || !this.remoteClient) {
            return { healthy: false, reason: 'Remote node not enabled' };
        }
        
        try {
            const start = Date.now();
            await (this.remoteClient as any).meta();
            const latency = Date.now() - start;
            
            return { healthy: true, latency };
        } catch (error: any) {
            return { healthy: false, reason: error.message };
        }
    }
    
    getPollingInterval(): number {
        // 2s = normal mode (public only OR using private node successfully)
        // 15s = fallback mode (private node failed, using public as backup + WS)
        return this.isUsingFallback ? 15000 : 2000;
    }
    
    onFallbackChange(callback: (isUsingFallback: boolean, interval: number) => void): () => void {
        this.fallbackListeners.add(callback);
        return () => this.fallbackListeners.delete(callback);
    }
    
    private enterFallbackMode() {
        if (this.isUsingFallback) return;
        
        this.isUsingFallback = true;
        if (!this.suppressErrors) {
            console.warn('[DUAL-INFO-CLIENT] ENTERING FALLBACK MODE - Remote node down, switching to 15s polling + WS');
        }
        
        const interval = this.getPollingInterval();
        this.fallbackListeners.forEach(cb => {
            try {
                cb(true, interval);
            } catch (e) {
                if (!this.suppressErrors) {
                    console.error('[DUAL-INFO-CLIENT] Fallback listener error:', e);
                }
            }
        });
        
        this.startHealthCheck();
    }
    
    private exitFallbackMode() {
        if (!this.isUsingFallback) return;
        
        this.isUsingFallback = false;
        this.consecutiveFailures = 0;
        console.log('[DUAL-INFO-CLIENT] EXITING FALLBACK MODE - Remote node recovered, resuming 2s polling');
        
        this.stopHealthCheck();
        
        const interval = this.getPollingInterval();
        this.fallbackListeners.forEach(cb => {
            try {
                cb(false, interval);
            } catch (e) {
                console.error('[DUAL-INFO-CLIENT] Fallback listener error:', e);
            }
        });
    }
    
    private startHealthCheck() {
        if (this.healthCheckInterval) return;
        
        console.log('[DUAL-INFO-CLIENT] Starting health check interval (every 30s)');
        
        this.healthCheckInterval = setInterval(async () => {
            try {
                const health = await this.healthCheck();
                if (health.healthy) {
                    console.log(`[DUAL-INFO-CLIENT] Health check: Remote node RECOVERED (latency: ${health.latency}ms)`);
                    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                    console.log('[DUAL-INFO-CLIENT] ✅ SWITCHING BACK TO PRIVATE NODE');
                    console.log('[DUAL-INFO-CLIENT] 🟢 Private node recovered and healthy');
                    console.log('[DUAL-INFO-CLIENT] 🔄 Now using: Private Node');
                    console.log('[DUAL-INFO-CLIENT] ⏱️  Polling interval: 2s (fast)');
                    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                    this.consecutiveFailures = 0;
                    this.exitFallbackMode();
                }
            } catch (e) {
                // Silent health check failure
            }
        }, 30000);
    }
    
    private stopHealthCheck() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }
    }
    
    destroy() {
        this.stopHealthCheck();
        this.fallbackListeners.clear();
    }
    
    getStats() {
        return { ...this.stats, isUsingFallback: this.isUsingFallback };
    }
}

// Type augmentation for methods
export interface DualInfoClient extends hl.InfoClient {}
