import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildReadClient, CONTRACT_ADDRESS } from '../client.js';

const configured =
  CONTRACT_ADDRESS &&
  CONTRACT_ADDRESS !== '0x0000000000000000000000000000000000000000';

export function useBounties(pollMs = 15_000) {
  const readClient = useMemo(() => buildReadClient(), []);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [locked, setLocked] = useState(0n);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!configured) {
      setLoading(false);
      return;
    }
    try {
      const [raw, lockedRaw] = await Promise.all([
        readClient.readContract({
          address: CONTRACT_ADDRESS,
          functionName: 'list_bounties',
          args: [0n, 50n],
        }),
        readClient.readContract({
          address: CONTRACT_ADDRESS,
          functionName: 'get_total_locked',
          args: [],
        }),
      ]);
      const parsed = JSON.parse(raw || '{"items":[],"total":0}');
      const list = (parsed.items || []).slice().reverse();
      setItems(list);
      setTotal(parsed.total || 0);
      setLocked(BigInt(lockedRaw ?? 0));
      setError('');
    } catch (err) {
      console.error('refresh failed', err);
      setError(err.shortMessage || err.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [readClient]);

  useEffect(() => {
    refresh();
  }, [refresh]);
  useEffect(() => {
    if (!pollMs) return undefined;
    const id = setInterval(refresh, pollMs);
    return () => clearInterval(id);
  }, [refresh, pollMs]);

  const stats = useMemo(() => {
    const s = { open: 0, claimed: 0, settled: 0, paid: 0n };
    for (const b of items) {
      if (b.status === 'OPEN') s.open += 1;
      else if (b.status === 'CLAIMED') s.claimed += 1;
      else s.settled += 1;
      try {
        s.paid += BigInt(b.payout || 0);
      } catch {}
    }
    return s;
  }, [items]);

  return { items, total, locked, stats, loading, error, refresh, configured };
}

export function useBounty(id) {
  const { items, refresh, loading, ...rest } = useBounties();
  const record = useMemo(() => items.find((b) => b.id === String(id)) || null, [items, id]);
  return { record, items, refresh, loading, ...rest };
}
