
"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { useSpotPricesStore } from "@/store/useSpotPricesStore";
import { hyperliquid } from "@/services/hyperliquid";
import { MarketStats } from "@/components/trading/MarketStats";
import { ChartWidget } from "@/components/trading/ChartWidget";
import { OrderBook } from "@/components/trading/OrderBook";
import { TradeForm } from "@/components/trading/TradeForm";
import { PositionsTable } from "@/components/trading/PositionsTable";
import { NewsSection } from "@/components/trading/NewsSection";
import { FundingSection } from "@/components/trading/FundingSection";
import { TrackerSection } from "@/components/trading/TrackerSection";
import { PerformancePanel } from "@/components/trading/PerformancePanel";
import { AssetSearchModal, Asset } from "@/components/trading/AssetSearchModal";
import { TradeDetailPanel } from "@/components/trading/TradeDetailPanel";
import { TradeSignal } from "@/hooks/useTradeDataManager";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle
} from "react-resizable-panels";
import { Book, PanelRight, PanelBottom, LayoutTemplate } from "lucide-react";

export default function TradingInterface() {
  const [isOrderBookExpanded, setIsOrderBookExpanded] = useState(false);
  const [activeView, setActiveView] = useState('chart');
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<{
    symbol: string; name: string; coin: string; displayName?: string; price: string; leverage: string;
    change24h?: number; volume?: string; openInterest?: string;
  } | null>({
    symbol: "BTC-USD",
    name: "BTC",
    coin: "BTC",
    displayName: "BTC",
    price: "",
    leverage: "50x"
  });
  const spotPrices = useSpotPricesStore(state => state.prices);

  // Fetch real initial BTC data on mount
  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        const allAssets = await hyperliquid.getAllAssets();
        const btc = allAssets.find(a => a.name === 'BTC');
        if (btc) {
          const fmtPrice = btc.price >= 1000
            ? `$${btc.price.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
            : `$${btc.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
          const fmtVol = btc.volume24h >= 1e9 ? `$${(btc.volume24h/1e9).toFixed(1)}B` : btc.volume24h >= 1e6 ? `$${(btc.volume24h/1e6).toFixed(1)}M` : `$${(btc.volume24h/1e3).toFixed(1)}K`;
          const fmtOI = btc.openInterest >= 1e9 ? `$${(btc.openInterest/1e9).toFixed(1)}B` : btc.openInterest >= 1e6 ? `$${(btc.openInterest/1e6).toFixed(1)}M` : `$${(btc.openInterest/1e3).toFixed(1)}K`;
          setSelectedAsset(prev => prev ? {
            ...prev,
            price: fmtPrice,
            leverage: `${btc.maxLeverage}x`,
            change24h: btc.change24h,
            volume: fmtVol,
            openInterest: fmtOI
          } : prev);
        }
      } catch (e) {
        console.warn('[Page] Failed to fetch initial data:', e);
      }
    };
    fetchInitialData();
  }, []);

  // Layout Visibility State
  const [showOrderBook, setShowOrderBook] = useState(true);
  const [showRightPanel, setShowRightPanel] = useState(true);
  const [showBottomPanel, setShowBottomPanel] = useState(true);
  const [showQuickTrade, setShowQuickTrade] = useState(true);

  // Signal Detail Panel State
  const [selectedSignal, setSelectedSignal] = useState<TradeSignal | null>(null);
  const [isDetailPanelOpen, setIsDetailPanelOpen] = useState(false);

  // Handle Cmd+K / Ctrl+K to open search modal
  const handleGlobalKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      setIsSearchModalOpen(true);
    }
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [handleGlobalKeyDown]);

  // Handle signal click to open detail panel
  const handleSignalClick = (signal: TradeSignal) => {
    console.log('[DETAIL PANEL] Signal clicked:', signal.asset, signal.id);
    setSelectedSignal(signal);
    setIsDetailPanelOpen(true);
    console.log('[DETAIL PANEL] State updated - panel should open');
  };

  const handlePanelClose = () => {
    console.log('[DETAIL PANEL] Closing panel');
    setIsDetailPanelOpen(false);
    setTimeout(() => setSelectedSignal(null), 300);
  };


  // Handle asset selection from modal
  const handleAssetSelect = (asset: Asset) => {
    setSelectedAsset({
      symbol: asset.symbol,
      name: asset.name,
      coin: asset.coin,
      displayName: asset.displayName,
      price: asset.price,
      leverage: asset.leverage,
      change24h: asset.change24h,
      volume: asset.volume,
      openInterest: asset.openInterest
    });
    console.log(`[Asset Select] ${asset.displayName} (${asset.category}): symbol=${asset.symbol}, name=${asset.name}, coin=${asset.coin}`)
  };


  // Render the appropriate view based on activeView
  const renderMainView = () => {
    if (activeView !== 'chart') {
      switch (activeView) {
        case 'news': return <NewsSection />;
        case 'funding': return <FundingSection />;
        case 'tracker': return <TrackerSection />;
        case 'performance': return <PerformancePanel />;
        default:      return <ChartWidget key={selectedAsset?.symbol || "BTC"} symbol={selectedAsset?.symbol || "BTC"} coin={selectedAsset?.coin} showQuickTrade={showQuickTrade} onHideQuickTrade={() => setShowQuickTrade(false)} />;
      }
    }

    return <ChartWidget key={selectedAsset?.symbol || "BTC"} symbol={selectedAsset?.symbol || "BTC"} coin={selectedAsset?.coin} showQuickTrade={showQuickTrade} onHideQuickTrade={() => setShowQuickTrade(false)} />;
  };

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden font-sans">

      {/* Main Content Area */}
      <div className="flex-1 flex p-1.5 gap-1.5 overflow-hidden min-h-0">
        {/* Left Main Column (Chart, Positions, and optional OrderBook) */}
        <div className="flex-1 flex flex-col min-w-0">
          <PanelGroup direction="vertical" className="flex-1">

            {/* Top Panel: Chart (+ OrderBook if collapsed) */}
            <Panel 
              defaultSize={showBottomPanel ? 70 : 100} 
              minSize={30} 
              className="flex flex-col min-h-0"
            >
              <div className="flex h-full w-full gap-1.5 min-h-0">

                {/* Chart Section */}
                <div className="flex-1 flex flex-col min-w-0 min-h-0 border border-border bg-card rounded-md overflow-hidden relative shadow-sm">
                  <div className="shrink-0">
                    <MarketStats
                      activeView={activeView}
                      onViewChange={setActiveView}
                      selectedAsset={selectedAsset}
                      onOpenSearch={() => setIsSearchModalOpen(true)}
                      showQuickTrade={showQuickTrade}
                      onToggleQuickTrade={() => setShowQuickTrade(!showQuickTrade)}
                    />
                  </div>
                  <div className="flex-1 relative min-h-0 p-2 bg-black/40">
                    {renderMainView()}
                  </div>
                </div>

                {/* OrderBook - Single Instance (Moves Between Collapsed/Expanded) */}
                {!isOrderBookExpanded && showOrderBook && (
                  <div className="w-[280px] shrink-0 border border-border bg-card rounded-md overflow-hidden flex flex-col min-h-0 shadow-sm">
                    <OrderBook
                      key="orderbook-main"
                      isExpanded={isOrderBookExpanded}
                      onToggleExpand={() => setIsOrderBookExpanded(true)}
                      selectedAsset={selectedAsset?.name || "BTC"}
                      coin={selectedAsset?.coin || selectedAsset?.name || "BTC"}
                      displayName={selectedAsset?.displayName || selectedAsset?.name || "BTC"}
                    />
                  </div>
                )}
              </div>
            </Panel>

            {/* Resizer - Only Show if Bottom Panel is Visible */}
            {showBottomPanel && (
              <PanelResizeHandle className="relative flex w-full h-3 items-center justify-center z-50 group outline-none cursor-row-resize">
                {/* Centered thick bar indicator */}
                <div className="w-12 h-1 rounded-full bg-border/50 group-hover:bg-primary/70 transition-colors" />
              </PanelResizeHandle>
            )}

            {/* Bottom Panel: Positions */}
            {showBottomPanel && (
              <Panel defaultSize={30} minSize={10} className="flex flex-col min-h-0">
                <div className="h-full w-full border border-border bg-card rounded-md overflow-hidden shadow-sm">
                  <PositionsTable 
                    onSignalClick={handleSignalClick} 
                    onAssetClick={async (assetName) => {
                      try {
                        // Look up full asset data from cache (same source as dropdown)
                        const allAssets = await hyperliquid.getAllAssets()
                        const found = allAssets.find(a => a.name === assetName)
                        if (found) {
                          const isSpot = found.category === 'spot'
                          const fmtPrice = found.price >= 1000
                            ? `$${found.price.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                            : found.price >= 1 ? `$${found.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : `$${found.price.toFixed(5)}`
                          const fmtVol = found.volume24h >= 1e9 ? `$${(found.volume24h/1e9).toFixed(1)}B` : found.volume24h >= 1e6 ? `$${(found.volume24h/1e6).toFixed(1)}M` : found.volume24h >= 1e3 ? `$${(found.volume24h/1e3).toFixed(1)}K` : '-'
                          const fmtOI = found.openInterest >= 1e9 ? `$${(found.openInterest/1e9).toFixed(1)}B` : found.openInterest >= 1e6 ? `$${(found.openInterest/1e6).toFixed(1)}M` : found.openInterest >= 1e3 ? `$${(found.openInterest/1e3).toFixed(1)}K` : '-'
                          setSelectedAsset({
                            symbol: isSpot ? found.displayName : `${found.name}-USD`,
                            name: found.name,
                            coin: found.coin,
                            displayName: found.displayName,
                            price: fmtPrice,
                            leverage: found.maxLeverage > 0 ? `${found.maxLeverage}x` : '1x',
                            change24h: found.change24h,
                            volume: fmtVol,
                            openInterest: fmtOI
                          })
                          console.log(`[Position Click] ${found.displayName}: leverage=${found.maxLeverage}x, price=${fmtPrice}`)
                          return
                        }
                      } catch (e) {
                        console.warn('[Position Click] Cache lookup failed, using fallback:', e)
                      }
                      // Fallback: resolve what we can
                      const isSpot = assetName.startsWith('@')
                      const resolvedDisplayName = await hyperliquid.getAssetDisplayNameAsync(assetName)
                      const resolvedCoin = hyperliquid.getAssetCoin(assetName)
                      setSelectedAsset({
                        symbol: isSpot ? resolvedDisplayName : `${assetName}-USD`,
                        name: assetName,
                        coin: resolvedCoin,
                        displayName: resolvedDisplayName,
                        price: "",
                        leverage: isSpot ? "1x" : "20x"
                      })
                    }}
                  />
                </div>
              </Panel>
            )}

          </PanelGroup>
        </div>

        {/* OrderBook (Expanded Mode - Same Instance) */}
        {isOrderBookExpanded && showOrderBook && (
          <div className="w-[280px] shrink-0 border border-border bg-card rounded-md overflow-hidden flex flex-col shadow-sm">
            <OrderBook
              key="orderbook-main"
              isExpanded={isOrderBookExpanded}
              onToggleExpand={() => setIsOrderBookExpanded(false)}
              selectedAsset={selectedAsset?.name || "BTC"}
              coin={selectedAsset?.coin || selectedAsset?.name || "BTC"}
              displayName={selectedAsset?.displayName || selectedAsset?.name || "BTC"}
            />
          </div>
        )}

        {/* Right Fixed Column: TradeForm */}
        {showRightPanel && (
          <div className="w-[320px] shrink-0 border border-border bg-card rounded-md overflow-hidden flex flex-col shadow-sm">
            <TradeForm
              selectedAsset={selectedAsset?.name || "BTC"}
              maxLeverage={selectedAsset?.leverage ? parseInt(selectedAsset.leverage) : 50}
              displayName={selectedAsset?.displayName || selectedAsset?.name || "BTC"}
            />
          </div>
        )}
      </div>

      {/* Footer / Status Bar */}
      <div className="flex shrink-0 h-8 items-center justify-between border-t border-border bg-background px-4 text-xs text-muted-foreground z-40 select-none">

        {/* Left: Status & Prices */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-primary">
            <div className="h-2 w-2 rounded-full bg-primary" />
            Connected
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <img src="https://cdn.jsdelivr.net/gh/atomiclabs/cryptocurrency-icons@1a63530be6e374711a8554f31b17e4cb92c25fa5/128/color/btc.png" alt="BTC" className="w-4 h-4" />
              <span className="text-orange-500 font-medium">₿ {spotPrices['BTC'] ? `$${spotPrices['BTC'].toLocaleString(undefined, { maximumFractionDigits: 2 })}` : (selectedAsset?.price || '...')}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <img src="https://cdn.jsdelivr.net/gh/atomiclabs/cryptocurrency-icons@1a63530be6e374711a8554f31b17e4cb92c25fa5/128/color/eth.png" alt="ETH" className="w-4 h-4" />
              <span className="text-blue-400 font-medium">ETH {spotPrices['ETH'] ? `$${spotPrices['ETH'].toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '...'}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <img src="/HYPE.svg" alt="HYPE" className="w-4 h-4" />
              <span className="text-primary font-medium">HYPE {spotPrices['HYPE'] ? `$${spotPrices['HYPE'].toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '...'}</span>
            </div>
          </div>
        </div>

        {/* Right: Layout Toggles & Links */}
        <div className="flex items-center gap-4">

          {/* Layout Controls */}
          <div className="flex items-center gap-2 border-r border-border pr-4 h-full">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setShowOrderBook(!showOrderBook)}
                className={cn("p-1 rounded hover:bg-muted/50 transition-colors", showOrderBook ? "text-primary bg-primary/10" : "text-muted-foreground")}
                title="Toggle Order Book"
              >
                <Book className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setShowBottomPanel(!showBottomPanel)}
                className={cn("p-1 rounded hover:bg-muted/50 transition-colors", showBottomPanel ? "text-primary bg-primary/10" : "text-muted-foreground")}
                title="Toggle Bottom Panel"
              >
                <PanelBottom className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setShowRightPanel(!showRightPanel)}
                className={cn("p-1 rounded hover:bg-muted/50 transition-colors", showRightPanel ? "text-primary bg-primary/10" : "text-muted-foreground")}
                title="Toggle Trade Form"
              >
                <PanelRight className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="w-px h-3 bg-border mx-1" />

            <button
              onClick={() => { setShowOrderBook(true); setShowBottomPanel(true); setShowRightPanel(true); }}
              className="p-1 rounded hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground"
              title="Reset Layout"
            >
              <LayoutTemplate className="h-3.5 w-3.5" />
            </button>
          </div>

        </div>
      </div>

      {/* Asset Search Modal */}
      <AssetSearchModal
        isOpen={isSearchModalOpen}
        onClose={() => setIsSearchModalOpen(false)}
        onSelect={handleAssetSelect}
        onCommand={(command) => {
          if (command === 'close_all' || command === 'close_longs' || command === 'close_shorts' || command === 'reverse_all') {
            // Mock action
            console.log("Command executed:", command);
          }
          if (command === 'expand_book') setShowOrderBook(true);

          // Close modal is handled by the component call
        }}
      />

      {/* Signal Detail Panel */}
      {isDetailPanelOpen && selectedSignal && (
        <TradeDetailPanel
          trade={selectedSignal}
          onClose={handlePanelClose}
        />
      )}
    </div>
  );
}
