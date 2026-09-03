import { useCallback, useEffect, useState } from 'react';
import { connectWallet } from '../client.js';

export function useWallet() {
  const [account, setAccount] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!window.ethereum) return;
    // Read existing accounts silently on mount (no prompt).
    window.ethereum
      .request({ method: 'eth_accounts' })
      .then((accts) => {
        if (accts && accts[0]) setAccount(accts[0]);
      })
      .catch(() => {});
    const handleAccountsChanged = (accts) => {
      setAccount(accts && accts[0] ? accts[0] : null);
    };
    const handleChainChanged = () => window.location.reload();
    window.ethereum.on?.('accountsChanged', handleAccountsChanged);
    window.ethereum.on?.('chainChanged', handleChainChanged);
    return () => {
      window.ethereum.removeListener?.('accountsChanged', handleAccountsChanged);
      window.ethereum.removeListener?.('chainChanged', handleChainChanged);
    };
  }, []);

  const connect = useCallback(async () => {
    setError('');
    try {
      const addr = await connectWallet();
      setAccount(addr);
      return addr;
    } catch (err) {
      setError(err.message || String(err));
      throw err;
    }
  }, []);

  return { account, connect, error };
}
