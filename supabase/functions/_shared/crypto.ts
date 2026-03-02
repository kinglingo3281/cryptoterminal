export function base64Encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

export function base64Decode(str: string): Uint8Array {
  return Uint8Array.from(atob(str), c => c.charCodeAt(0));
}

export async function encryptAESGCM(
  key: Uint8Array,
  plaintext: string
): Promise<{ ciphertext: Uint8Array; iv: Uint8Array }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await crypto.subtle.importKey(
    'raw', key as BufferSource, { name: 'AES-GCM' }, false, ['encrypt']
  );
  const encoder = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource, tagLength: 128 },
    cryptoKey,
    encoder.encode(plaintext)
  );
  return { ciphertext: new Uint8Array(ciphertext), iv };
}

export async function decryptAESGCM(
  key: Uint8Array,
  ciphertext: Uint8Array,
  iv: Uint8Array
): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw', key as BufferSource, { name: 'AES-GCM' }, false, ['decrypt']
  );
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource, tagLength: 128 },
    cryptoKey,
    ciphertext as BufferSource
  );
  const decoder = new TextDecoder();
  return decoder.decode(plaintext);
}

export async function verifyPrivyToken(token: string) {
  console.log('[CRYPTO] Verifying Privy token...');
  console.log('[CRYPTO] Token length:', token?.length || 0);
  console.log('[CRYPTO] PRIVY_APP_ID:', Deno.env.get('PRIVY_APP_ID'));
  
  const response = await fetch('https://auth.privy.io/api/v1/users/me', {
    headers: {
      'Authorization': `Bearer ${token}`,
      'privy-app-id': Deno.env.get('PRIVY_APP_ID')!,
      'Origin': Deno.env.get('SUPABASE_URL') || 'https://your-project.supabase.co'
    }
  });
  
  console.log('[VERIFY-TOKEN] Response status:', response.status);
  
  if (!response.ok) {
    const errorText = await response.text();
    console.log('[VERIFY-TOKEN] ERROR Response:', errorText);
    throw new Error(`Privy token verification failed: ${response.status} - ${errorText}`);
  }
  
  const data = await response.json();
  console.log('[VERIFY-TOKEN] Full response:', JSON.stringify(data));
  
  // Privy API returns user data nested under 'user' key
  const user = data.user;
  if (!user || !user.id) {
    console.log('[VERIFY-TOKEN] ERROR: No user data in response');
    throw new Error('Invalid user data from Privy');
  }
  
  console.log('[VERIFY-TOKEN] User ID:', user.id);
  
  // Extract wallet address from linked_accounts
  const walletAccount = user.linked_accounts?.find((acc: any) => acc.type === 'wallet');
  const emailAccount = user.linked_accounts?.find((acc: any) => acc.type === 'email');
  
  return {
    id: user.id,
    email: emailAccount?.address || null,
    wallet: walletAccount ? { address: walletAccount.address } : null
  };
}
