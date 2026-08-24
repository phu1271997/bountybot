import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  buildReadClient,
  buildWriteClient,
  connectWallet,
  ensureCorrectChain,
  CONTRACT_ADDRESS,
  CHAIN,
} from './client.js';

function formatGen(wei) {
  if (!wei) return '0';
  const big = BigInt(wei);
  const whole = big / 10n ** 18n;
  const frac = big % 10n ** 18n;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(18, '0').slice(0, 4);
  return `${whole}.${fracStr}`;
}

function short(addr) {
  if (!addr) return '';
  return addr.slice(0, 6) + '…' + addr.slice(-4);
}

const EXPLORER_TX = 'https://genlayer-explorer.vercel.app/tx/';

export default function AppView() {
  const [account, setAccount] = useState(null);
  const [issueUrl, setIssueUrl] = useState('');
  const [amountGen, setAmountGen] = useState('0.1');
  const [claimBid, setClaimBid] = useState('');
  const [claimPr, setClaimPr] = useState('');
  const [adjBid, setAdjBid] = useState('');
  const [bounties, setBounties] = useState([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [lastTxHash, setLastTxHash] = useState('');

  const readClient = useMemo(() => buildReadClient(), []);
  const writeClient = useMemo(
    () => (account ? buildWriteClient(account) : null),
    [account],
  );
  const configured = CONTRACT_ADDRESS && CONTRACT_ADDRESS !== '0x0000000000000000000000000000000000000000';

  const refresh = useCallback(async () => {
    if (!configured) return;
    try {
      const raw = await readClient.readContract({
        address: CONTRACT_ADDRESS,
        functionName: 'list_bounties',
        args: [0n, 50n],
      });
      const parsed = JSON.parse(raw || '{"items": [], "total": 0}');
      const items = (parsed.items || []).slice().reverse();
      setBounties(items);
    } catch (err) {
      console.error('refresh failed', err);
    }
  }, [readClient, configured]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const id = setInterval(refresh, 15_000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    if (!window.ethereum) return;
    const handleAccountsChanged = (accounts) => {
      setAccount(accounts && accounts[0] ? accounts[0] : null);
    };
    const handleChainChanged = () => window.location.reload();
    window.ethereum.on?.('accountsChanged', handleAccountsChanged);
    window.ethereum.on?.('chainChanged', handleChainChanged);
    return () => {
      window.ethereum.removeListener?.('accountsChanged', handleAccountsChanged);
      window.ethereum.removeListener?.('chainChanged', handleChainChanged);
    };
  }, []);

  const doConnect = async () => {
    setError('');
    try {
      const addr = await connectWallet();
      setAccount(addr);
    } catch (err) {
      setError(err.message || String(err));
    }
  };

  const withTx = async (label, fn) => {
    setError('');
    setBusy(label);
    setLastTxHash('');
    try {
      await ensureCorrectChain();
      const hash = await fn();
      if (hash) {
        setLastTxHash(hash);
        try {
          await writeClient.waitForTransactionReceipt({ hash, retries: 150, interval: 3000 });
        } catch (waitErr) {
          console.warn('waitForTransactionReceipt fell short — polling refresh anyway', waitErr);
        }
      }
      await refresh();
    } catch (err) {
      console.error(err);
      setError(err.shortMessage || err.message || String(err));
    } finally {
      setBusy('');
    }
  };

  const doCreate = () => withTx('Locking GEN and posting bounty…', async () => {
    const value = BigInt(Math.floor(parseFloat(amountGen) * 1e18));
    if (value <= 0n) throw new Error('Amount must be > 0');
    const hash = await writeClient.writeContract({
      address: CONTRACT_ADDRESS,
      functionName: 'create_bounty',
      args: [issueUrl.trim()],
      value,
    });
    setIssueUrl('');
    return hash;
  });

  const doClaim = () => withTx('Submitting claim on-chain…', async () => {
    const hash = await writeClient.writeContract({
      address: CONTRACT_ADDRESS,
      functionName: 'submit_claim',
      args: [claimBid.trim(), claimPr.trim()],
      value: 0n,
    });
    setClaimBid('');
    setClaimPr('');
    return hash;
  });

  const doAdjudicate = () => withTx(
    'Running validator consensus (fetching GitHub, LLM voting)…',
    async () => {
      const hash = await writeClient.writeContract({
        address: CONTRACT_ADDRESS,
        functionName: 'adjudicate',
        args: [adjBid.trim()],
        value: 0n,
      });
      setAdjBid('');
      return hash;
    },
  );

  return (
    <main>
      {!configured && (
        <div className="status-bar">
          VITE_CONTRACT_ADDRESS is not set — set it in Vercel or copy .env.example to .env.local.
        </div>
      )}
      <nav className="app-nav">
        <Link to="/" className="back-link">← Back to landing</Link>
        <span className="brand-tag">$ bountybot --network studionet</span>
      </nav>
      <h1>BountyBot</h1>
      <p className="tag">
        Post a bounty against a GitHub issue. The Intelligent Contract fetches the issue,
        the PR, and the raw diff directly on-chain, then validator LLMs vote on whether the
        PR actually fixes it. Payout runs itself.
      </p>

      <div className="card">
        <div className="row">
          {account ? (
            <span>
              Connected: <code>{short(account)}</code> · chain <code>{CHAIN.name}</code>
            </span>
          ) : (
            <button onClick={doConnect}>Connect MetaMask</button>
          )}
          {configured && (
            <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: 13 }}>
              Contract: <code>{short(CONTRACT_ADDRESS)}</code>
            </span>
          )}
        </div>
        {error && <p style={{ color: 'var(--bad)', marginTop: 10 }}>{error}</p>}
        {busy && (
          <p style={{ color: 'var(--muted)', marginTop: 10 }}>
            {busy}<span className="spinner" />
          </p>
        )}
        {lastTxHash && (
          <p style={{ marginTop: 10, fontSize: 13 }}>
            Latest tx:{' '}
            <a href={EXPLORER_TX + lastTxHash} target="_blank" rel="noreferrer">
              {short(lastTxHash)}
            </a>
          </p>
        )}
      </div>

      <div className="card">
        <h3>1 · Create bounty</h3>
        <label>GitHub issue URL</label>
        <input
          placeholder="https://github.com/org/repo/issues/123"
          value={issueUrl}
          onChange={(e) => setIssueUrl(e.target.value)}
        />
        <label>Reward (GEN)</label>
        <input
          type="number"
          min="0"
          step="0.01"
          value={amountGen}
          onChange={(e) => setAmountGen(e.target.value)}
        />
        <button disabled={!account || !issueUrl || !!busy} onClick={doCreate}>
          Lock GEN &amp; post bounty
        </button>
      </div>

      <div className="card">
        <h3>2 · Claim a bounty</h3>
        <label>Bounty ID</label>
        <input value={claimBid} onChange={(e) => setClaimBid(e.target.value)} placeholder="1" />
        <label>Your PR URL</label>
        <input
          value={claimPr}
          onChange={(e) => setClaimPr(e.target.value)}
          placeholder="https://github.com/org/repo/pull/456"
        />
        <button disabled={!account || !claimBid || !claimPr || !!busy} onClick={doClaim}>
          Submit claim
        </button>
      </div>

      <div className="card">
        <h3>3 · Adjudicate</h3>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>
          Anyone can trigger AI adjudication once a claim is on-chain. Validator LLMs read the
          issue and PR diff, judge whether it fixes the issue, and vote. Funds release
          automatically. This transaction takes 30–120 seconds because validators do real
          inference before consensus finalizes.
        </p>
        <label>Bounty ID</label>
        <input value={adjBid} onChange={(e) => setAdjBid(e.target.value)} placeholder="1" />
        <button disabled={!account || !adjBid || !!busy} onClick={doAdjudicate}>
          Run validator consensus
        </button>
      </div>

      <div className="card">
        <h3>Bounties</h3>
        {bounties.length === 0 && <p style={{ color: 'var(--muted)' }}>No bounties yet.</p>}
        {bounties.map((b) => (
          <div key={b.id} className="bounty">
            <div className="row">
              <strong>#{b.id}</strong>
              <span className={`pill ${b.status}`}>{b.status}</span>
              {b.quality && (
                <span
                  className={`pill ${
                    b.quality === 'HIGH'
                      ? 'PAID_FULL'
                      : b.quality === 'MID'
                      ? 'PAID_PARTIAL'
                      : 'REJECTED'
                  }`}
                >
                  quality: {b.quality}
                </span>
              )}
              <span style={{ marginLeft: 'auto', color: 'var(--muted)' }}>
                {formatGen(b.amount)} GEN
              </span>
            </div>
            <div className="meta">
              issue:{' '}
              <a href={b.issue_url} target="_blank" rel="noreferrer">
                {b.issue_url}
              </a>
            </div>
            {b.pr_url && (
              <div className="meta">
                PR:{' '}
                <a href={b.pr_url} target="_blank" rel="noreferrer">
                  {b.pr_url}
                </a>{' '}
                by {short(b.claimer)}
              </div>
            )}
            {(b.status === 'PAID_FULL' || b.status === 'PAID_PARTIAL' || b.status === 'REJECTED') && (
              <div className="meta">
                payout: {formatGen(b.payout)} GEN · refund: {formatGen(b.refund)} GEN
              </div>
            )}
            {b.reason && (
              <div className="reason">
                <strong>AI reason:</strong> {b.reason}
              </div>
            )}
          </div>
        ))}
      </div>

      <footer style={{ marginTop: 40, color: 'var(--muted)', fontSize: 12, textAlign: 'center' }}>
        Powered by{' '}
        <a href="https://genlayer.com" target="_blank" rel="noreferrer">
          GenLayer
        </a>{' '}
        Intelligent Contracts on {CHAIN.name}
      </footer>
    </main>
  );
}
