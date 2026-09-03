import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import TopNav from '../components/TopNav.jsx';
import Footer from '../components/Footer.jsx';
import {
  buildWriteClient,
  ensureCorrectChain,
  CONTRACT_ADDRESS,
} from '../client.js';
import { useWallet } from '../hooks/useWallet.js';

const EXPLORER_TX = 'https://genlayer-explorer.vercel.app/tx/';
const ISSUE_RE = /^https:\/\/github\.com\/[A-Za-z0-9_.\-]+\/[A-Za-z0-9_.\-]+\/issues\/\d+\/?$/;

export default function CreateBountyPage() {
  const { account, connect } = useWallet();
  const nav = useNavigate();
  const [issueUrl, setIssueUrl] = useState('');
  const [amountGen, setAmountGen] = useState('0.1');
  const [mode, setMode] = useState('open');
  const [assignee, setAssignee] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [lastTxHash, setLastTxHash] = useState('');

  const writeClient = useMemo(() => (account ? buildWriteClient(account) : null), [account]);
  const issueValid = ISSUE_RE.test(issueUrl.trim());
  const assigneeValid = mode === 'open' || /^0x[0-9a-fA-F]{40}$/.test(assignee.trim());
  const amountValid = parseFloat(amountGen) > 0;
  const canSubmit = account && issueValid && amountValid && assigneeValid && !busy;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setLastTxHash('');
    setBusy('Locking GEN and posting bounty…');
    try {
      await ensureCorrectChain();
      const value = BigInt(Math.floor(parseFloat(amountGen) * 1e18));
      if (value <= 0n) throw new Error('Amount must be > 0');
      const hash = await writeClient.writeContract({
        address: CONTRACT_ADDRESS,
        functionName: 'create_bounty',
        args: [issueUrl.trim(), mode === 'assigned' ? assignee.trim() : ''],
        value,
      });
      setLastTxHash(hash);
      await writeClient
        .waitForTransactionReceipt({ hash, retries: 150, interval: 3000 })
        .catch(() => {});
      // Read fresh count and jump to newest bounty detail.
      const count = await writeClient.readContract({
        address: CONTRACT_ADDRESS,
        functionName: 'get_bounty_count',
        args: [],
      });
      nav(`/bounty/${count}`);
    } catch (err) {
      console.error(err);
      setError(err.shortMessage || err.message || String(err));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="app-shell">
      <TopNav active="create" />
      <main className="page page--narrow">
        <header className="page__hero">
          <div>
            <h1 className="page__title">Post a bounty</h1>
            <p className="page__lead">
              Lock GEN against a GitHub issue. Anyone can claim it — or pin it to a
              specific contributor with direct assignment.
            </p>
          </div>
        </header>

        {!account && (
          <div className="notice notice--warn">
            <strong>Wallet not connected.</strong> Connect MetaMask to sign the create
            transaction.
            <div style={{ marginTop: 10 }}>
              <button className="btn btn-primary btn-small" onClick={connect}>
                connect metamask
              </button>
            </div>
          </div>
        )}

        <form className="form-card" onSubmit={submit}>
          <div className="form-row">
            <label htmlFor="issue">GitHub issue URL</label>
            <input
              id="issue"
              placeholder="https://github.com/org/repo/issues/123"
              value={issueUrl}
              onChange={(e) => setIssueUrl(e.target.value)}
              aria-invalid={issueUrl.length > 0 && !issueValid}
            />
            <p className="form-hint">
              Only <code>github.com</code> issue URLs. The PR that claims it must live in
              the same <code>owner/repo</code>.
            </p>
          </div>

          <div className="form-row">
            <label htmlFor="amount">Reward</label>
            <div className="amount-input">
              <input
                id="amount"
                type="number"
                min="0"
                step="0.01"
                value={amountGen}
                onChange={(e) => setAmountGen(e.target.value)}
              />
              <span className="amount-input__unit">GEN</span>
            </div>
            <div className="preset-row">
              {[0.05, 0.1, 0.5, 1].map((v) => (
                <button
                  key={v}
                  type="button"
                  className="chip"
                  onClick={() => setAmountGen(String(v))}
                >
                  {v} GEN
                </button>
              ))}
            </div>
          </div>

          <div className="form-row">
            <label>Assignment</label>
            <div className="segmented" role="radiogroup">
              <button
                type="button"
                role="radio"
                aria-checked={mode === 'open'}
                className={'segmented__btn' + (mode === 'open' ? ' is-active' : '')}
                onClick={() => setMode('open')}
              >
                <strong>Open bounty</strong>
                <span>Any contributor can claim it. First valid PR wins.</span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={mode === 'assigned'}
                className={'segmented__btn' + (mode === 'assigned' ? ' is-active' : '')}
                onClick={() => setMode('assigned')}
              >
                <strong>Direct assignment</strong>
                <span>Only the pinned wallet may submit a claim.</span>
              </button>
            </div>
            {mode === 'assigned' && (
              <div style={{ marginTop: 12 }}>
                <input
                  placeholder="0xAssigneeWalletAddress…"
                  value={assignee}
                  onChange={(e) => setAssignee(e.target.value)}
                  aria-invalid={assignee.length > 0 && !assigneeValid}
                />
                <p className="form-hint">
                  Useful when you&apos;ve already negotiated the work with a specific
                  contributor and want to prevent front-running.
                </p>
              </div>
            )}
          </div>

          {error && <div className="notice notice--bad">{error}</div>}
          {busy && (
            <div className="notice notice--info">
              {busy} <span className="spinner" />
            </div>
          )}
          {lastTxHash && (
            <p className="muted" style={{ marginTop: 6 }}>
              tx{' '}
              <a href={EXPLORER_TX + lastTxHash} target="_blank" rel="noreferrer">
                {lastTxHash.slice(0, 10)}…
              </a>
            </p>
          )}

          <div className="form-actions">
            <button className="btn btn-primary" type="submit" disabled={!canSubmit}>
              lock GEN &amp; post bounty
            </button>
          </div>
        </form>
      </main>
      <Footer />
    </div>
  );
}
