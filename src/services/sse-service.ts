// SSE Service for handling Server-Sent Events connection
import { styleManager } from '@/lib/crypto-auth';
import pako from 'pako';

interface SSEMessage {
    type: string;
    data: any;
}

const LOG_SSE = false;

const log = (...args: unknown[]) => {
    if (LOG_SSE) {
        console.log(...args);
    }
};

const logWarn = (...args: unknown[]) => {
    if (LOG_SSE) {
        console.warn(...args);
    }
};

const logError = (...args: unknown[]) => {
    if (LOG_SSE) {
        console.error(...args);
    }
};

type SSEEventType = 
    | 'connected'
    | 'disconnected'
    | 'trades-data'
    | 'assets-data'
    | 'new-trades-data'
    | 'enhanced-trades-data'
    | 'enhanced-assets-data'
    | 'market-context-data'
    | 'cluster-data-update'
    | 'trade-details'
    | 'heartbeat'
    | 'error'
    | 'state-change'
    | 'server-shutdown';

type SSECallback = (data: any) => void;

class SSEService {
    private eventSource: EventSource | null = null;
    private clientId: string | null = null;
    private isConnected: boolean = false;
    private reconnectAttempts: number = 0;
    private maxReconnectAttempts: number = 5;
    private reconnectDelay: number = 5000;
    private listeners: Map<SSEEventType, SSECallback[]> = new Map();
    private connectionState: 'disconnected' | 'connecting' | 'connected' | 'error' = 'disconnected';
    private rateLimited: boolean = false;
    private connectionLimited: boolean = false;
    private lastErrorCode: number | null = null;

    /**
     * Initialize SSE connection with authentication and error handling
     */
    async connect(): Promise<void> {
        log('[🔌 SSE] connect() called - Starting connection process');
        
        // Idempotency: don't reconnect if already connected
        if (this.isConnected && this.eventSource) {
            log('[🔌 SSE] Already connected, skipping reconnect');
            return;
        }
        
        // Don't reconnect if currently connecting
        if (this.connectionState === 'connecting') {
            log('[🔌 SSE] Connection in progress, skipping duplicate connect');
            return;
        }
        
        try {
            log('[🔌 SSE] Setting state to connecting...');
            this.setConnectionState('connecting');
            await this.closeConnection();
            
            // Reset security flags
            this.rateLimited = false;
            this.connectionLimited = false;
            this.lastErrorCode = null;
            
            log('[🔑 SSE] Generating authentication parameters...');
            // Generate authentication parameters
            const authParams = await styleManager.buildStyleConfig();
            this.clientId = authParams.clientId;
            log('[🔑 SSE] Auth params generated:', { clientId: this.clientId });
            
            // Build authenticated URL with obfuscated parameters
            const baseUrl = this.getBaseUrl();
            const streamPath = this.decodeStreamPath();
            log('[🌐 SSE] Base URL:', baseUrl);
            log('[🌐 SSE] Stream path:', streamPath);
            
            // Obfuscate auth parameters to hide sensitive data in URL
            const obfuscatedAuth = btoa(authParams.theme).replace(/[=]/g, '');
            const obfuscatedTimestamp = btoa(authParams.timestamp.toString()).replace(/[=]/g, '');
            const obfuscatedClientId = btoa(authParams.clientId).replace(/[=]/g, '');
            
            const url = `${baseUrl}/${streamPath}?a=${obfuscatedAuth}&t=${obfuscatedTimestamp}&c=${obfuscatedClientId}`;
            log('[🌐 SSE] Full URL:', url);
            
            // Create EventSource connection
            log('[🔌 SSE] Creating EventSource connection...');
            this.eventSource = new EventSource(url);
            this.setupEventHandlers();
            log('[✅ SSE] EventSource created, handlers setup complete');
            
        } catch (error) {
            logError('[❌ SSE] Connection failed:', error);
            this.handleConnectionFailure(error as Error);
        }
    }

    /**
     * Get base URL from environment
     */
    private getBaseUrl(): string {
        const url = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';
        log('[⚙️ SSE] Server URL:', url);
        return url;
    }

    /**
     * Decode stream path (returns 'events')
     */
    private decodeStreamPath(): string {
        return 'events';
    }

    /**
     * Handle connection failures with appropriate error types
     */
    private handleConnectionFailure(error: Error): void {
        this.setConnectionState('error');
        
        if (error.message.includes('Rate limited')) {
            this.rateLimited = true;
            this.emit('error', { message: 'Rate limited. Please wait before reconnecting.', error });
            this.scheduleReconnect(true);
        } else if (error.message.includes('Connection limit')) {
            this.connectionLimited = true;
            this.emit('error', { message: 'Connection limit reached. Close other connections.', error });
            this.scheduleReconnect(true);
        } else if (error.message.includes('Authentication failed')) {
            this.emit('error', { message: 'Authentication failed. Check credentials.', error });
            this.scheduleReconnect();
        } else {
            this.emit('error', { message: 'Failed to establish connection', error });
            this.scheduleReconnect();
        }
    }

    /**
     * Setup EventSource event handlers
     */
    private setupEventHandlers(): void {
        if (!this.eventSource) {
            logError('[❌ SSE] setupEventHandlers called but eventSource is null!');
            return;
        }

        log('[🎧 SSE] Setting up event handlers...');

        this.eventSource.onopen = () => {
            log('[✅ SSE] Connection opened successfully!');
            this.setConnectionState('connected');
            this.reconnectAttempts = 0;
            this.emit('connected', { clientId: this.clientId });
        };

        this.eventSource.onmessage = (event) => {
            // console.log('[📨 SSE] Message received:', event.data.substring(0, 100) + '...');
            try {
                const data = this.decompressMessage(event.data);
                // console.log('[📨 SSE] Message decompressed, type:', data.type);
                this.handleMessage(data);
            } catch (error) {
                logError('[❌ SSE] Failed to parse SSE message:', error);
                this.emit('error', { message: 'Invalid message format', error });
            }
        };

        this.eventSource.onerror = (error) => {
            logError('[❌ SSE] EventSource error:', error);
            log('[❌ SSE] ReadyState:', this.eventSource?.readyState);
            
            if (this.eventSource && this.eventSource.readyState === EventSource.CLOSED) {
                log('[❌ SSE] Connection closed, handling error...');
                this.handleConnectionError();
            } else if (this.eventSource && this.eventSource.readyState === EventSource.CONNECTING) {
                log('[🔄 SSE] Connection attempting to reconnect...');
                this.setConnectionState('connecting');
            }
        };

        log('[✅ SSE] Event handlers registered');
    }

    /**
     * Decompress SSE message if compressed (browser-compatible using pako)
     * @param rawData - Raw SSE message data
     * @returns Parsed message object
     */
    private decompressMessage(rawData: string): SSEMessage {
        try {
            // Check if message is compressed (GZIP prefix)
            if (rawData.startsWith('GZIP:')) {
                // Extract base64 encoded data
                const encoded = rawData.substring(5);
                
                // Decode base64 to Uint8Array
                const binaryString = atob(encoded);
                const compressed = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    compressed[i] = binaryString.charCodeAt(i);
                }
                
                // Decompress with pako (browser-compatible gzip)
                const decompressed = pako.ungzip(compressed, { to: 'string' });
                
                // Parse JSON
                return JSON.parse(decompressed);
            } else {
                // Legacy: uncompressed JSON
                return JSON.parse(rawData);
            }
        } catch (error) {
            logError('SSE decompression failed:', error);
            throw new Error(`Decompression failed: ${(error as Error).message}`);
        }
    }

    /**
     * Handle incoming SSE messages
     * @param data - Parsed message data
     */
    private handleMessage(data: SSEMessage): void {
        const { type, data: payload } = data;
        
        switch (type) {
            case 'all-trades':
                this.emit('trades-data', payload);
                break;
            case 'all-assets':
                this.emit('assets-data', payload);
                break;
            case 'enhanced-trades':
                this.emit('enhanced-trades-data', payload);
                break;
            case 'enhanced-assets':
                this.emit('enhanced-assets-data', payload);
                break;
            case 'market-context':
                this.emit('market-context-data', payload);
                break;
            case 'cluster-update':
                this.emit('cluster-data-update', payload);
                break;
            case 'trade-details':
                this.emit('trade-details', payload);
                break;
            case 'new-trades':
                this.emit('new-trades-data', payload);
                break;
            case 'connected':
                this.emit('connected', payload);
                break;
            case 'heartbeat':
                this.handleHeartbeat(payload);
                break;
            case 'error':
                this.handleError(payload);
                break;
            case 'server-shutdown':
                this.handleServerShutdown(payload);
                break;
            default:
                logWarn('Unknown SSE message type:', type);
        }
    }

    /**
     * Set connection state and update UI
     * @param state - New connection state
     */
    private setConnectionState(state: 'disconnected' | 'connecting' | 'connected' | 'error'): void {
        const previousState = this.connectionState;
        this.connectionState = state;
        this.isConnected = state === 'connected';
        
        if (previousState !== state) {
            this.emit('state-change', { state, previousState });
        }
    }

    /**
     * Handle connection errors with proper error type detection
     */
    private handleConnectionError(): void {
        if (this.rateLimited) {
            this.setConnectionState('error');
            this.emit('error', { message: 'Rate limited. Please wait before reconnecting.' });
            this.scheduleReconnect(true);
            return;
        }
        
        if (this.connectionLimited) {
            this.setConnectionState('error');
            this.emit('error', { message: 'Connection limit reached. Close other connections.' });
            this.scheduleReconnect(true);
            return;
        }
        
        this.setConnectionState('error');
        this.emit('disconnected', { reason: 'Connection closed by server' });
        this.scheduleReconnect();
    }
    
    /**
     * Schedule reconnection attempt with security-aware delays
     */
    private scheduleReconnect(isSecurityError: boolean = false): void {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            logError('Max reconnection attempts reached');
            this.emit('error', { message: 'Connection failed after multiple attempts' });
            return;
        }
        
        this.reconnectAttempts++;
        
        let baseDelay = this.reconnectDelay;
        if (isSecurityError) {
            baseDelay = Math.max(30000, this.reconnectDelay * 3);
        }
        
        const delay = baseDelay * Math.pow(2, this.reconnectAttempts - 1);
        
        setTimeout(() => {
            if (this.connectionState !== 'connected') {
                this.connect();
            }
        }, delay);
    }

    /**
     * Close SSE connection
     */
    async closeConnection(): Promise<void> {
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }
        
        this.setConnectionState('disconnected');
        this.clientId = null;
    }

    /**
     * Disconnect and cleanup
     */
    async disconnect(): Promise<void> {
        this.reconnectAttempts = this.maxReconnectAttempts;
        await this.closeConnection();
        this.listeners.clear();
    }

    /**
     * Add event listener
     * @param event - Event name
     * @param callback - Callback function
     */
    on(event: SSEEventType, callback: SSECallback): void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event)!.push(callback);
    }

    /**
     * Remove event listener
     * @param event - Event name
     * @param callback - Callback function to remove
     */
    off(event: SSEEventType, callback: SSECallback): void {
        if (this.listeners.has(event)) {
            const callbacks = this.listeners.get(event)!;
            const index = callbacks.indexOf(callback);
            if (index > -1) {
                callbacks.splice(index, 1);
            }
        }
    }

    /**
     * Emit event to listeners
     * @param event - Event name
     * @param data - Event data
     */
    private emit(event: SSEEventType, data: any): void {
        if (this.listeners.has(event)) {
            this.listeners.get(event)!.forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    logError(`Error in event listener for ${event}:`, error);
                }
            });
        }
    }

    /**
     * Handle error messages from server
     * @param payload - Error payload
     */
    private handleError(payload: any): void {
        logError('SSE Server Error:', payload);
        this.emit('error', payload);
    }

    /**
     * Handle server shutdown notification
     * @param payload - Shutdown payload
     */
    private handleServerShutdown(payload: any): void {
        logWarn('SSE Server Shutdown:', payload);
        this.emit('server-shutdown', payload);
        this.closeConnection();
    }

    /**
     * Handle heartbeat messages from server
     * @param payload - Heartbeat payload
     */
    private handleHeartbeat(payload: any): void {
        this.emit('heartbeat', payload);
    }

    /**
     * Get current connection info
     * @returns Connection information
     */
    getConnectionInfo() {
        return {
            state: this.connectionState,
            isConnected: this.isConnected,
            clientId: this.clientId,
            reconnectAttempts: this.reconnectAttempts,
            readyState: this.eventSource ? this.eventSource.readyState : null,
        };
    }
}

// Export singleton instance
export const sseService = new SSEService();
