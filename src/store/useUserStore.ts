import { create } from 'zustand';

interface APICredentials {
  [key: string]: any;
}

interface UserData {
  id: string;
  privy_id: string;
  email: string | null;
  wallet_address: string | null;
}

interface UserStore {
  user: UserData | null;
  apiKeys: { [provider: string]: APICredentials } | null;
  isLoading: boolean;
  error: string | null;
  
  setUserData: (user: UserData, apiKeys: { [provider: string]: APICredentials }) => void;
  clearUserData: () => void;
  addAPIKey: (provider: string, credentials: APICredentials) => void;
  removeAPIKey: (provider: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useUserStore = create<UserStore>((set) => ({
  user: null,
  apiKeys: null,
  isLoading: false,
  error: null,
  
  setUserData: (user, apiKeys) => set({ user, apiKeys, error: null }),
  
  clearUserData: () => set({ 
    user: null, 
    apiKeys: null, 
    error: null 
  }),
  
  addAPIKey: (provider, credentials) => set((state) => ({
    apiKeys: { ...(state.apiKeys || {}), [provider]: credentials }
  })),
  
  removeAPIKey: (provider) => set((state) => {
    if (!state.apiKeys) return state;
    const { [provider]: _, ...remainingKeys } = state.apiKeys;
    return { apiKeys: Object.keys(remainingKeys).length > 0 ? remainingKeys : null };
  }),
  
  setLoading: (loading) => set({ isLoading: loading }),
  
  setError: (error) => set({ error, isLoading: false })
}));
