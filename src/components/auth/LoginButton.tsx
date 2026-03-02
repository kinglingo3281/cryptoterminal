'use client';

import { useAuth } from '@/hooks/useAuth';
import { LogOut, User, Settings } from 'lucide-react';
import { useState } from 'react';
import { usePositionsStore } from '@/store/usePositionsStore';
import { useSpotPricesStore } from '@/store/useSpotPricesStore';

export function LoginButton() {
  const { isAuthenticated, privyUser, user, login, logout, isLoading } = useAuth();
  const [showDropdown, setShowDropdown] = useState(false);
  const accountSummary = usePositionsStore(state => state.accountSummary);
  const spotPrices = useSpotPricesStore(state => state.prices);
  
  // Calculate total balance: PERP account value + SPOT balances USD value
  const calculateTotalBalance = () => {
    let total = 0;
    
    // Add PERP account value (already in USD)
    if (accountSummary?.accountValue) {
      total += accountSummary.accountValue;
    }
    
    // Add SPOT balances USD value
    if (accountSummary?.spotBalances) {
      accountSummary.spotBalances.forEach(balance => {
        if (balance.total > 0) {
          if (balance.coin === 'USDC' || balance.coin === 'USDH') {
            // Stablecoins are 1:1
            total += balance.total;
          } else {
            // Get price from spot prices store
            const price = spotPrices[balance.coin] || 0;
            total += balance.total * price;
          }
        }
      });
    }
    
    return total;
  };
  
  const totalBalance = calculateTotalBalance();
  
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 border-l border-border pl-4">
        <div className="text-sm font-mono text-muted-foreground">
          ${totalBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
        </div>
        <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center">
          <div className="h-3 w-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }
  
  if (isAuthenticated && privyUser) {
    const displayEmail = privyUser.email?.address;
    const displayWallet = privyUser.wallet?.address;
    const displayText = displayEmail || (displayWallet ? `${displayWallet.slice(0, 6)}...${displayWallet.slice(-4)}` : 'User');
    
    return (
      <>
        <div className="flex items-center gap-2 border-l border-border pl-4 relative">
          <div className="text-sm font-mono text-muted-foreground">
            ${totalBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
          </div>
          <div className="relative">
            <button
              onClick={() => setShowDropdown(!showDropdown)}
              className="h-8 w-8 rounded-full bg-secondary hover:bg-secondary/80 flex items-center justify-center transition-colors"
            >
              <User className="h-4 w-4" />
            </button>
            
            {showDropdown && (
              <>
                <div 
                  className="fixed inset-0 z-10" 
                  onClick={() => setShowDropdown(false)}
                />
                <div className="absolute right-0 top-10 w-56 bg-card border border-border rounded-lg shadow-lg z-20 py-2">
                  <div className="px-4 py-2 border-b border-border">
                    <p className="text-xs text-muted-foreground">Signed in as</p>
                    <p className="text-sm font-medium truncate">{displayText}</p>
                  </div>
                  <button
                    onClick={() => {
                      setShowDropdown(false);
                      window.location.href = '/profile?tab=api-keys';
                    }}
                    className="w-full px-4 py-2 text-left text-sm hover:bg-secondary transition-colors flex items-center gap-2"
                  >
                    <Settings className="h-4 w-4" />
                    Manage API Keys
                  </button>
                  <button
                    onClick={() => {
                      setShowDropdown(false);
                      logout();
                    }}
                    className="w-full px-4 py-2 text-left text-sm hover:bg-secondary transition-colors flex items-center gap-2 text-destructive"
                  >
                    <LogOut className="h-4 w-4" />
                    Logout
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </>
    );
  }
  
  return (
    <div className="flex items-center gap-3 border-l border-border pl-4">
      <div className="text-sm font-mono text-muted-foreground">
        ${totalBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
      </div>
      <button
        onClick={login}
        className="flex items-center gap-2 rounded-md bg-secondary px-3 py-1.5 text-sm font-medium hover:bg-secondary/80"
      >
        <User className="h-4 w-4" />
        Login
      </button>
    </div>
  );
}
