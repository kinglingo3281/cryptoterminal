import { useState, useEffect } from 'react';
import { hyperliquid } from '../services/hyperliquid';

export function useHyperliquid() {
    const [isConnected, setIsConnected] = useState(false);
    const [prices, setPrices] = useState<Record<string, number>>({});

    useEffect(() => {
        // Init logic, maybe fetch initial metadata
        hyperliquid.loadMetadata().then(() => {
            console.log("Metadata loaded");
        });
    }, []);

    const connect = async (pk: string) => {
        const success = await hyperliquid.connect(pk);
        setIsConnected(success);
        return success;
    };

    return {
        isConnected,
        connect,
        service: hyperliquid
    };
}
