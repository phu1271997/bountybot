import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import TopNav from '../components/TopNav.jsx';
import Footer from '../components/Footer.jsx';
import { useBounties } from '../hooks/useBounties.js';

const EXPLORER_ADDR = 'https://genlayer-explorer.vercel.app/address/';

const RESOLVED = ['PAID_FULL', 'PAID_PARTIAL', 'REJECTED', 'EXPIRED'];

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

const FILTERS = [
  { key: 'all', label: 'all resolved', match: (b) => RESOLVED.includes(b.status) },
  { key: 'paid', label: 'paid full', match: (b) => b.status === 'PAID_FULL' },
  { key: 'partial', label: 'partial', match: (b) => b.status === 'PAID_PARTIAL' },
  { key: 'rejected', label: 'rejected', match: (b) => b.status === 'REJECTED' },
  { key: 'expired', label: 'expired', match: (b) => b.status === 'EXPIRED' },
];

export default function ExplorerPage() {
  const { items, loading, configured, error } = useBounties();
  const [filter, setFilter] = useState('all');

  const resolved = useMemo(() => items.filter((b) => RESOLVED.includes(b.status)), [items]);

  const totals = useMemo(() => {
    const t = { paid: 0n, refunded: 0n, full: 0, partial: 0, rejected: 0, expired: 0 };
    for (const b of resolved) {
      try { t.paid += BigInt(b.payout || 0); } catch {}
      try { t.refunded += BigInt(b.refund || 0); } catch {}
      if (b.status === 'PAID_FULL') t.full += 1;
      else if (b.status === 'PAID_PARTIAL') t.partial += 1;
      else if (b.status === 'REJECTED') t.rejected += 1;
      else if (b.status === 'EXPIRED') t.expired += 1;
    }
    return t;
  }, [resolved]);

  const rows = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter) || FILTERS[0];
    return resolved.filter(f.match);
  }, [resolved, filter]);

  return (
    <div className="app-shell">
      <TopNav active="explorer" />
      <main className="page">
        <section className="page__hero">
          <div>
            <h1 className="page__title">Case explorer</h1>
            <p className="page__lead">
              Every resolved bounty this contract has adjudicated — the AI verdict, the
              quality tier, the SHA the consensus was pinned to, and the on-chain payout.
              Read-only and fully public: no wallet required.
            </p>
          </div>
          <Link to="/app" className="btn btn-ghost">open bounty board</Link>
        </section>

        <section className="stat-row">
          <div className="stat">
            <span className="stat__label">resolved cases</span>
            <span className="stat__value">{resolved.length}</span>
          </div>
          <div className="stat">
            <span className="stat__label">paid to contributors</span>
            <span className="stat__value">{formatGen(totals.paid)} <em>GEN</em></span>
          </div>
          <div className="stat">
            <span className="stat__label">refunded to sponsors</span>
            <span className="stat__value">{formatGen(totals.refunded)} <em>GEN</em></span>
          </div>
          <div className="stat">
            <span className="stat__label">full · partial</span>
            <span className="stat__value">{totals.full} · {totals.partial}</span>
          </div>
          <div className="stat">
            <span className="stat__label">rejected · expired</span>
            <span className="stat__value">{totals.rejected} · {totals.expired}</span>
          </div>
        </section>

        {!configured && (
          <div className="notice notice--warn">
            <strong>VITE_CONTRACT_ADDRESS is not set.</strong> The explorer cannot read
            resolved cases until the contract address is configured.
          </div>
        )}
        {error && <div className="notice notice--bad"><strong>Read failed:</strong> {error}</div>}

        <section className="toolbar">
          <div className="toolbar__filters" role="tablist" aria-label="Filter resolved cases">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                role="tab"
                aria-selected={filter === f.key}
                className={'chip' + (filter === f.key ? ' is-active' : '')}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </section>

        {loading && <p className="muted">loading resolved cases…</p>}

        {!loading && rows.length === 0 && (
          <div className="empty">
            <p className="empty__title">No resolved cases yet.</p>
            <p className="empty__body">
              Once a claimed bounty is adjudicated, its verdict and payout show up here.
            </p>
            <Link to="/app" className="btn btn-primary">go to the board</Link>
          </div>
        )}

        {!loading && rows.length > 0 && (
          <div className="table-scroll">
            <table className="explorer-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>repo</th>
                  <th>verdict</th>
                  <th>identity</th>
                  <th>pinned commit</th>
                  <th className="num">payout</th>
                  <th className="num">refund</th>
                  <th>AI reason</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <Link to={`/bounty/${b.id}`} className="mono">#{b.id}</Link>
                    </td>
                    <td className="mono">{repoFrom(b.issue_url) || '—'}</td>
                    <td>
                      <span className={`pill pill--${b.status}`}>{b.status.replace('_', ' ')}</span>
                      {b.quality && (
                        <span className={`pill pill--quality pill--q-${b.quality}`}>{b.quality}</span>
                      )}
                    </td>
                    <td>
                      {b.wallet_bound === false ? (
                        <span className="pill pill--bad">not bound</span>
                      ) : b.claimer ? (
                        <a href={EXPLORER_ADDR + b.claimer} target="_blank" rel="noreferrer" title={b.claimer}>
                          <code>{short(b.claimer)}</code>
                        </a>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      {b.head_sha ? (
                        <a href={commitUrl(b.pr_url, b.head_sha)} target="_blank" rel="noreferrer" title={b.head_sha}>
                          <code>{b.head_sha.slice(0, 10)}…</code>
                        </a>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="num">{formatGen(b.payout)}</td>
                    <td className="num">{formatGen(b.refund)}</td>
                    <td className="reason-cell" title={b.reason}>{b.reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
