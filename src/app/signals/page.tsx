'use client';

import { AISignals } from '@/components/trading/AISignals';

export default function SignalsPage() {
    return (
        <div className="min-h-screen bg-zinc-950 p-4">
            <div className="max-w-7xl mx-auto space-y-4">
                {/* Page Header */}
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h1 className="text-2xl font-bold text-zinc-100 mb-1">
                            AI Trading Signals
                        </h1>
                        <p className="text-sm text-zinc-400">
                            Real-time AI-powered trading signals with live SSE connection
                        </p>
                    </div>
                </div>

                {/* AI Signals Component */}
                <div className="h-[calc(100vh-12rem)]">
                    <AISignals />
                </div>

                {/* Info Footer */}
                <div className="mt-6 p-4 bg-zinc-900 border border-zinc-800 rounded-lg">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-zinc-400">
                        <div>
                            <span className="font-semibold text-zinc-300">Auto-Cleanup:</span>
                            <p className="mt-1">Signals older than 10 minutes are automatically removed</p>
                        </div>
                        <div>
                            <span className="font-semibold text-zinc-300">Real-Time:</span>
                            <p className="mt-1">Live SSE connection with auto-reconnect on failure</p>
                        </div>
                        <div>
                            <span className="font-semibold text-zinc-300">Compression:</span>
                            <p className="mt-1">GZIP decompression for efficient bandwidth usage</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
