'use client';

import { PrivyProvider as PrivyProviderBase } from '@privy-io/react-auth';
import { useEffect, useState } from 'react';

export function PrivyProvider({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  if (!mounted) return <>{children}</>;

  return (
    <PrivyProviderBase
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID || 'placeholder'}
      config={{
        loginMethods: ['wallet', 'email'],
        appearance: {
          theme: 'dark',
          accentColor: '#2DBD85',
          logo: '/globe.svg',
          showWalletLoginFirst: true,
          walletList: ['detected_ethereum_wallets', 'metamask', 'coinbase_wallet', 'rainbow', 'phantom', 'rabby_wallet', 'wallet_connect'],
        },
        embeddedWallets: {
          createOnLogin: 'off'
        }
      }}
    >
      {children}
    </PrivyProviderBase>
  );
}
