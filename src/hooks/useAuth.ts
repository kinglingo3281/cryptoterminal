import { usePrivy } from '@privy-io/react-auth';
import { useUserStore } from '@/store/useUserStore';
import { usePositionsStore } from '@/store/usePositionsStore';
import { useSpotPricesStore } from '@/store/useSpotPricesStore';
import { useTradeHistoryStore } from '@/store/useTradeHistoryStore';
import { useTrackerStore } from '@/store/useTrackerStore';
import { useFundingStore } from '@/store/useFundingStore';
import { useChaseStore } from '@/store/useChaseStore';
import { exploreService } from '@/services/ExploreService';
import { useEffect, useRef } from 'react';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export function useAuth() {
  const { 
    authenticated, 
    user: privyUser, 
    login, 
    logout: privyLogout,
    getAccessToken 
  } = usePrivy();
  
  const { user, apiKeys, isLoading, setUserData, clearUserData, setLoading, setError } = useUserStore();
  const isFetchingRef = useRef(false);
  
  useEffect(() => {
    if (authenticated && privyUser && !user && !isFetchingRef.current && !isLoading) {
      fetchUserData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, privyUser, user]);
  
  async function fetchUserData(force: boolean = false) {
    if (isFetchingRef.current && !force) {
      console.log('[useAuth] Fetch already in progress, skipping...');
      return;
    }
    
    try {
      isFetchingRef.current = true;
      setLoading(true);
      
      const token = await getAccessToken();
      
      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/get-user-data`,
        {
          headers: {
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'X-Privy-Token': token || '',
            'Content-Type': 'application/json'
          }
        }
      );
      
      if (!response.ok) {
        if (response.status === 429) {
          console.warn('[useAuth] Rate limit hit, will retry on next user action');
          setLoading(false);
          setError('Too many requests. Please wait a moment and try again.');
          return;
        }
        
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch user data');
      }
      
      const data = await response.json();
      
      setUserData(data.user, data.api_keys);
      
      // Persist wallet address to localStorage for TrackerService to use on app init
      if (data.user?.wallet_address) {
        localStorage.setItem('userWalletAddress', data.user.wallet_address);
      }
      
      setLoading(false);
      
    } catch (error) {
      console.error('Error fetching user data:', error);
      setError(error instanceof Error ? error.message : 'Unknown error');
      setLoading(false);
    } finally {
      isFetchingRef.current = false;
    }
  }
  
  async function logout() {
    // Clear all user-related state
    clearUserData();
    
    // Clear positions, orders, account summary
    usePositionsStore.getState().reset();
    
    // Clear spot prices
    useSpotPricesStore.getState().reset();
    
    // Clear trade history
    useTradeHistoryStore.getState().clear();
    
    // Clear tracker data and disconnect SSE
    useTrackerStore.getState().reset();
    
    // Clear funding data
    useFundingStore.getState().reset();
    
    // Clear chase data
    const chaseState = useChaseStore.getState();
    for (const chaseId of chaseState.activeChases.keys()) {
      chaseState.removeChase(chaseId);
    }
    
    // Stop explore service background aggregation
    exploreService.stop();
    
    // Clear persisted data from localStorage
    localStorage.removeItem('userWalletAddress');
    localStorage.removeItem('chase-storage');
    localStorage.removeItem('automation-settings');
    
    // Logout from Privy
    await privyLogout();
    
    // Force full page reload to kill all WebSockets, polling intervals, and singletons
    window.location.href = '/';
  }
  
  async function addAPIKey(
    provider: string,
    label: string,
    credentials: Record<string, any>
  ) {
    try {
      const token = await getAccessToken();
      
      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/add-api-key`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'X-Privy-Token': token || '',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ provider, label, credentials })
        }
      );
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to add API key');
      }
      
      // Immediately add to store so UI updates even if refresh fails
      useUserStore.getState().addAPIKey(provider, { ...credentials, label });
      
      // Try to refresh full data, but don't fail the add operation if refresh fails (e.g. 429)
      try {
        await fetchUserData(true);
      } catch (refreshError) {
        console.warn('[addAPIKey] Refresh failed (non-critical):', refreshError);
      }
      
      return { success: true };
      
    } catch (error) {
      console.error('Error adding API key:', error);
      throw error;
    }
  }
  
  async function deleteAPIKey(provider: string) {
    try {
      setLoading(true);
      
      const token = await getAccessToken();
      
      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/delete-api-key`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'X-Privy-Token': token || '',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ provider })
        }
      );
      
      if (!response.ok) {
        if (response.status === 404) {
          const error = await response.json();
          throw new Error(error.error || 'API key not found');
        }
        
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete API key');
      }
      
      // Try to refresh data, but don't fail the delete operation if refresh fails (e.g. 429)
      try {
        await fetchUserData(true);
      } catch (refreshError) {
        console.warn('[deleteAPIKey] Refresh failed (non-critical):', refreshError);
      }
      
      return { success: true };
      
    } catch (error) {
      console.error('Error deleting API key:', error);
      setLoading(false);
      throw error;
    }
  }
  
  return {
    isAuthenticated: authenticated,
    privyUser,
    user,
    apiKeys,
    isLoading,
    login,
    logout,
    addAPIKey,
    deleteAPIKey,
    refreshUserData: fetchUserData
  };
}
