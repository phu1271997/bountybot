import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import TopNav from '../components/TopNav.jsx';
import Footer from '../components/Footer.jsx';
import {
  buildWriteClient,
  ensureCorrectChain,
  CONTRACT_ADDRESS,
} from '../client.js';
import { useBounty } from '../hooks/useBounties.js';
import { useWallet } from '../hooks/useWallet.js';

const EXPLORER_TX = 'https://genlayer-explorer.vercel.app/tx/';
const EXPLORER_ADDR = 'https://genlayer-explorer.vercel.app/address/';
const PR_RE = /^https:\/\/github\.com\/[A-Za-z0-9_.\-]+\/[A-Za-z0-9_.\-]+\/pull\/\d+\/?$/;

function short(v) {
  if (!v) return '';
  return v.slice(0, 6) + '…' + v.slice(-4);
}

function formatGen(wei) {
  if (!wei) return '0';
  try {
    const big = BigInt(wei);
    const whole = big / 10n ** 18n;
    const frac = big % 10n ** 18n;
    if (frac === 0n) return whole.toString();
    return `${whole}.${frac.toString().padStart(18, '0').slice(0, 4)}`;
  } catch {
    return String(wei);
  }
}

function repoFrom(url) {
  const m = /github\.com\/([A-Za-z0-9_.\-]+)\/([A-Za-z0-9_.\-]+)\//.exec(url || '');
  return m ? `${m[1]}/${m[2]}` : '';
}

function commitUrl(pr_url, sha) {
  if (!pr_url || !sha) return '';
  return pr_url.replace(/\/pull\/\d+\/?$/, `/commit/${sha}`);
}

function Stage({ index, title, active, done, children }) {
  const state = done ? 'done' : active ? 'active' : 'idle';
  return (
    <div className={`stage stage--${state}`}>
      <div className="stage__num">{done ? '✓' : index}</div>
      <div className="stage__body">
        <h3 className="stage__title">{title}</h3>
        {children}
      </div>
    </div>
  );
}

export default function BountyDetailPage() {
  const { id } = useParams();
  const { record, loading, refresh } = useBounty(id);
  const { account, connect } = useWallet();
  const [prUrl, setPrUrl] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [lastTxHash, setLastTxHash] = useState('');
  const [copied, setCopied] = useState(false);

  const writeClient = useMemo(() => (account ? buildWriteClient(account) : null), [account]);
  const repo = record ? repoFrom(record.issue_url) : '';
  const isSponsor = record && account && record.sponsor.toLowerCase() === account.toLowerCase();
  const isAssigned = record && record.assignee;
  const canClaim = record?.status === 'OPEN' && (!isAssigned || (account && account.toLowerCase() === record.assignee.toLowerCase()));
  const canAdjudicate = record?.status === 'CLAIMED';
  const settled = record && ['PAID_FULL', 'PAID_PARTIAL', 'REJECTED'].includes(record.status);
  const prValid = PR_RE.test(prUrl.trim());
  const walletLine = account ? `Bounty claim by: ${account}` : '';

  const withTx = async (label, fn) => {
    setError('');
    setBusy(label);
    setLastTxHash('');
    try {
      await ensureCorrectChain();
      const hash = await fn();
      if (hash) {
        setLastTxHash(hash);
        await writeClient
          .waitForTransactionReceipt({ hash, retries: 200, interval: 3000 })
          .catch(() => {});
      }
      await refresh();
    } catch (err) {
      console.error(err);
      setError(err.shortMessage || err.message || String(err));
    } finally {
      setBusy('');
    }
  };

  const submitClaim = () =>
    withTx('Submitting claim on-chain…', () =>
      writeClient.writeContract({
        address: CONTRACT_ADDRESS,
        functionName: 'submit_claim',
        args: [String(id), prUrl.trim()],
        value: 0n,
      }),
    );

  const adjudicate = () =>
    withTx('Running validator consensus (fetch + LLM vote, 30–120s)…', () =>
      writeClient.writeContract({
        address: CONTRACT_ADDRESS,
        functionName: 'adjudicate',
        args: [String(id)],
        value: 0n,
      }),
    );

  const cancel = () =>
    withTx('Cancelling and refunding sponsor…', () =>
      writeClient.writeContract({
        address: CONTRACT_ADDRESS,
        functionName: 'cancel_open_bounty',
        args: [String(id)],
        value: 0n,
      }),
    );

  const copyWalletLine = async () => {
    if (!walletLine) return;
    try {
      await navigator.clipboard.writeText(walletLine);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  if (loading && !record) {
    return (
      <div className="app-shell">
        <TopNav />
        <main className="page page--narrow">
          <p className="muted">loading bounty #{id}…</p>
        </main>
      </div>
    );
  }

  if (!record) {
    return (
      <div className="app-shell">
        <TopNav />
        <main className="page page--narrow">
          <div className="empty">
            <p className="empty__title">Bounty #{id} not found.</p>
            <p className="empty__body">It may have been posted on a different contract address.</p>
            <Link to="/app" className="btn btn-ghost">back to dashboard</Link>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <TopNav />
      <main className="page">
        <nav className="crumbs">
          <Link to="/app">dashboard</Link>
          <span>/</span>
          <span>bounty #{record.id}</span>
        </nav>

        <section className="detail-hero">
          <div>
            <div className="detail-hero__pills">
              <span className={`pill pill--${record.status}`}>{record.status.replace('_', ' ')}</span>
              {record.assignee ? (
                <span className="pill pill--tag" title={record.assignee}>
                  assigned to {short(record.assignee)}
                </span>
              ) : (
                <span className="pill pill--tag pill--open">open bounty</span>
              )}
              {record.quality && <span className={`pill pill--quality pill--q-${record.quality}`}>quality {record.quality}</span>}
              {record.wallet_bound === false && (
                <span className="pill pill--bad">identity not bound</span>
              )}
            </div>
            <h1 className="page__title">
              #{record.id} · <span className="mono">{repo || 'unknown/repo'}</span>
            </h1>
            <p className="page__lead">
              <a href={record.issue_url} target="_blank" rel="noreferrer">
                {record.issue_url.replace('https://github.com/', '')}
              </a>
            </p>
          </div>
          <div className="detail-hero__amount">
            <span className="detail-hero__amount-value">{formatGen(record.amount)}</span>
            <span className="detail-hero__amount-unit">GEN locked</span>
          </div>
        </section>

        <section className="fact-grid">
          <div className="fact">
            <span className="fact__label">Sponsor</span>
            <a
              href={EXPLORER_ADDR + record.sponsor}
              target="_blank"
              rel="noreferrer"
              className="fact__value"
              title={record.sponsor}
            >
              <code>{short(record.sponsor)}</code>
            </a>
          </div>
          <div className="fact">
            <span className="fact__label">Claimer</span>
            <span className="fact__value">
              {record.claimer ? (
                <a href={EXPLORER_ADDR + record.claimer} target="_blank" rel="noreferrer" title={record.claimer}>
                  <code>{short(record.claimer)}</code>
                </a>
              ) : (
                <em className="muted">— unclaimed —</em>
              )}
            </span>
          </div>
          <div className="fact">
            <span className="fact__label">PR</span>
            <span className="fact__value">
              {record.pr_url ? (
                <a href={record.pr_url} target="_blank" rel="noreferrer">
                  {record.pr_url.replace('https://github.com/', '')}
                </a>
              ) : (
                <em className="muted">— none —</em>
              )}
            </span>
          </div>
          <div className="fact">
            <span className="fact__label">SHA-pinned commit</span>
            <span className="fact__value">
              {record.head_sha ? (
                <a href={commitUrl(record.pr_url, record.head_sha)} target="_blank" rel="noreferrer" title={record.head_sha}>
                  <code>{record.head_sha.slice(0, 12)}…</code>
                </a>
              ) : (
                <em className="muted">— pending —</em>
              )}
            </span>
          </div>
          <div className="fact">
            <span className="fact__label">Payout</span>
            <span className="fact__value">{formatGen(record.payout)} GEN</span>
          </div>
          <div className="fact">
            <span className="fact__label">Refund</span>
            <span className="fact__value">{formatGen(record.refund)} GEN</span>
          </div>
        </section>

        {record.reason && (
          <section className="verdict-panel">
            <span className="verdict-panel__label">AI verdict — reason</span>
            <p className="verdict-panel__text">{record.reason}</p>
          </section>
        )}

        {!account && (
          <div className="notice notice--warn">
            <strong>Wallet not connected.</strong> Connect MetaMask to interact with this
            bounty.
            <div style={{ marginTop: 10 }}>
              <button className="btn btn-primary btn-small" onClick={connect}>
                connect metamask
              </button>
            </div>
          </div>
        )}

        <section className="stages">
          <Stage index="1" title="Post the bounty" done={true} active={false}>
            <p className="muted">Sponsor locked {formatGen(record.amount)} GEN against this issue.</p>
          </Stage>

          <Stage
            index="2"
            title="Submit a PR claim"
            done={record.status !== 'OPEN'}
            active={record.status === 'OPEN'}
          >
            {record.status === 'OPEN' ? (
              <div className="stage__form">
                {record.assignee && account && account.toLowerCase() !== record.assignee.toLowerCase() && (
                  <div className="notice notice--warn">
                    This bounty is pinned to <code>{short(record.assignee)}</code>. Only that
                    wallet can submit a claim.
                  </div>
                )}
                <div className="wallet-line-card">
                  <span className="wallet-line-card__label">
                    Include this line in one of your PR&apos;s <strong>commit messages</strong>:
                  </span>
                  <div className="wallet-line-card__row">
                    <code className="wallet-line-card__value">
                      {walletLine || '— connect wallet to preview —'}
                    </code>
                    <button
                      type="button"
                      className="btn btn-ghost btn-small"
                      onClick={copyWalletLine}
                      disabled={!walletLine}
                    >
                      {copied ? 'copied' : 'copy'}
                    </button>
                  </div>
                  <details>
                    <summary>quickest way — empty commit</summary>
                    <pre className="cmd-block">
{`git commit --allow-empty -m "Bounty claim by: ${account || '0xYOUR_WALLET'}"
git push`}
                    </pre>
                  </details>
                </div>
                <label htmlFor="pr">Your PR URL</label>
                <input
                  id="pr"
                  placeholder="https://github.com/org/repo/pull/456"
                  value={prUrl}
                  onChange={(e) => setPrUrl(e.target.value)}
                  aria-invalid={prUrl.length > 0 && !prValid}
                />
                <p className="form-hint">
                  Must live in the same repo as the issue (<code>{repo || 'org/repo'}</code>).
                </p>
                <button
                  className="btn btn-primary"
                  onClick={submitClaim}
                  disabled={!account || !prValid || !canClaim || !!busy}
                >
                  submit claim
                </button>
                {isSponsor && (
                  <button
                    className="btn btn-ghost btn-small"
                    onClick={cancel}
                    disabled={!!busy}
                    style={{ marginLeft: 10 }}
                  >
                    cancel &amp; refund
                  </button>
                )}
              </div>
            ) : (
              <p className="muted">
                Claimed by <code>{short(record.claimer)}</code>.
                {record.pr_url && <> PR: <a href={record.pr_url} target="_blank" rel="noreferrer">{record.pr_url.replace('https://github.com/', '')}</a></>}
              </p>
            )}
          </Stage>

          <Stage
            index="3"
            title="AI adjudication"
            done={settled}
            active={canAdjudicate}
          >
            {canAdjudicate ? (
              <div>
                <p className="muted">
                  Fetch issue + PR patch + SHA-pinned commit patch on-chain, run validator
                  LLM vote, settle payout. Takes 30–120 seconds.
                </p>
                <button
                  className="btn btn-primary"
                  onClick={adjudicate}
                  disabled={!account || !!busy}
                >
                  run validator consensus
                </button>
              </div>
            ) : settled ? (
              <p className="muted">
                Settled: {formatGen(record.payout)} GEN paid to claimer,{' '}
                {formatGen(record.refund)} GEN refunded to sponsor.
              </p>
            ) : (
              <p className="muted">Waiting for a claim…</p>
            )}
          </Stage>
        </section>

        {(busy || error || lastTxHash) && (
          <section className="tx-strip">
            {busy && <span className="tx-strip__busy">{busy} <span className="spinner" /></span>}
            {error && <span className="tx-strip__error">{error}</span>}
            {lastTxHash && (
              <span className="tx-strip__tx">
                tx{' '}
                <a href={EXPLORER_TX + lastTxHash} target="_blank" rel="noreferrer">
                  {lastTxHash.slice(0, 10)}…
                </a>
              </span>
            )}
          </section>
        )}
      </main>
      <Footer />
    </div>
  );
}
