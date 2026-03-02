// Theme processing utilities for style management (HMAC authentication)
import { themeProcessor } from './stylings';
import CryptoJS from 'crypto-js';

const LOG_AUTH = false;

const log = (...args: unknown[]) => {
    if (LOG_AUTH) {
        console.log(...args);
    }
};

const logError = (...args: unknown[]) => {
    if (LOG_AUTH) {
        console.error(...args);
    }
};

interface AuthParams {
    theme: string;
    timestamp: number;
    clientId: string;
    challenge: string;
}

class StyleManager {
    private algorithm: string;

    constructor() {
        this.algorithm = 'SHA-256';
    }

    /**
     * Generate HMAC signature using crypto-js (works in all contexts)
     * @param data - Data to sign
     * @param themeKey - Theme palette key (decoded password)
     * @returns Hex encoded signature
     */
    async processThemeData(data: string, themeKey: string): Promise<string> {
        try {
            // Use crypto-js for HMAC-SHA256 (works in both HTTP and HTTPS)
            const signature = CryptoJS.HmacSHA256(data, themeKey);
            return signature.toString(CryptoJS.enc.Hex);
        } catch (error) {
            logError('HMAC generation failed:', error);
            throw new Error('Failed to generate authentication signature');
        }
    }

    /**
     * Generate authentication parameters for SSE connection
     * @returns Auth parameters object
     */
    async buildStyleConfig(): Promise<AuthParams> {
        log('[🔐 AUTH] Building style config...');
        const timestamp = Date.now();
        const clientId = `client_${timestamp}_${Math.random().toString(36).substring(2, 11)}`;
        const styleData = `${timestamp}:${clientId}`;
        log('[🔐 AUTH] Generated clientId:', clientId);
        
        try {
            // Get decoded password from ThemeProcessor
            log('[🔐 AUTH] Getting primary style from ThemeProcessor...');
            const styleConfig = themeProcessor.getPrimaryStyle();
            log('[🔐 AUTH] Style config obtained, length:', styleConfig.length);
            
            log('[🔐 AUTH] Generating HMAC signature...');
            const themeHash = await this.processThemeData(styleData, styleConfig);
            log('[🔐 AUTH] HMAC signature generated, length:', themeHash.length);
            
            return {
                theme: themeHash,
                timestamp: timestamp,
                clientId: clientId,
                challenge: styleData
            };
        } catch (error) {
            logError('[❌ AUTH] Auth parameter generation failed:', error);
            throw error;
        }
    }

    /**
     * Validate timestamp to prevent replay attacks
     * @param timestamp - Timestamp to validate
     * @returns True if timestamp is valid
     */
    isTimestampValid(timestamp: number): boolean {
        const now = Date.now();
        const age = now - timestamp;
        const AUTH_TIMEOUT = 300000; // 5 minutes
        return age >= 0 && age <= AUTH_TIMEOUT;
    }
}

// Export singleton instance
export const styleManager = new StyleManager();
