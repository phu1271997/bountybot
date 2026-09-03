import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import TopNav from '../components/TopNav.jsx';
import Footer from '../components/Footer.jsx';
import BountyCard from '../components/BountyCard.jsx';
import { useBounties } from '../hooks/useBounties.js';

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

const FILTERS = [
  { key: 'all', label: 'all' },
  { key: 'open', label: 'open', status: (b) => b.status === 'OPEN' },
  { key: 'claimed', label: 'claimed', status: (b) => b.status === 'CLAIMED' },
  { key: 'settled', label: 'settled', status: (b) => ['PAID_FULL', 'PAID_PARTIAL', 'REJECTED'].includes(b.status) },
  { key: 'assigned', label: 'direct-assigned', status: (b) => !!b.assignee },
];

export default function DashboardPage() {
  const { items, total, locked, stats, loading, configured, error } = useBounties();
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter);
    const q = search.trim().toLowerCase();
    return items
      .filter((b) => (f?.status ? f.status(b) : true))
      .filter((b) => (q ? (b.issue_url || '').toLowerCase().includes(q) || (b.pr_url || '').toLowerCase().includes(q) || b.id === q : true));
  }, [items, filter, search]);

  return (
    <div className="app-shell">
      <TopNav active="dashboard" />
      <main className="page">
        <section className="page__hero">
          <div>
            <h1 className="page__title">Bounty board</h1>
            <p className="page__lead">
              Every bounty ever posted to this contract, in one list. Anyone can trigger
              adjudication on a claimed bounty — the AI verdict + payout are on-chain.
            </p>
          </div>
          <Link to="/create" className="btn btn-primary">+ post a bounty</Link>
        </section>

        <section className="stat-row">
          <div className="stat">
            <span className="stat__label">total bounties</span>
            <span className="stat__value">{total}</span>
          </div>
          <div className="stat">
            <span className="stat__label">locked in escrow</span>
            <span className="stat__value">{formatGen(locked)} <em>GEN</em></span>
          </div>
          <div className="stat">
            <span className="stat__label">open</span>
            <span className="stat__value">{stats.open}</span>
          </div>
          <div className="stat">
            <span className="stat__label">claimed</span>
            <span className="stat__value">{stats.claimed}</span>
          </div>
          <div className="stat">
            <span className="stat__label">settled</span>
            <span className="stat__value">{stats.settled}</span>
          </div>
        </section>

        {!configured && (
          <div className="notice notice--warn">
            <strong>VITE_CONTRACT_ADDRESS is not set.</strong> Copy <code>frontend/.env.example</code>
            to <code>.env.local</code> and paste the deployed address, or set the env on Vercel.
          </div>
        )}
        {error && <div className="notice notice--bad"><strong>Read failed:</strong> {error}</div>}

        <section className="toolbar">
          <div className="toolbar__filters" role="tablist" aria-label="Filter bounties">
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
          <input
            className="toolbar__search"
            placeholder="filter by repo, PR, or bounty #"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </section>

        <section className="bcard-list">
          {loading && <p className="muted">loading bounties…</p>}
          {!loading && filtered.length === 0 && (
            <div className="empty">
              <p className="empty__title">No bounties match this filter.</p>
              <p className="empty__body">
                Post the first one and set the tone for the board.
              </p>
              <Link to="/create" className="btn btn-primary">+ post a bounty</Link>
            </div>
          )}
          {filtered.map((b) => (
            <BountyCard key={b.id} b={b} />
          ))}
        </section>
      </main>
      <Footer />
    </div>
  );
}
