import { Link } from 'react-router-dom';

function short(addr) {
  if (!addr) return '';
  return addr.slice(0, 6) + '…' + addr.slice(-4);
}

function formatGen(wei) {
  if (!wei) return '0';
  try {
    const big = BigInt(wei);
    const whole = big / 10n ** 18n;
    const frac = big % 10n ** 18n;
    if (frac === 0n) return whole.toString();
    const fracStr = frac.toString().padStart(18, '0').slice(0, 4);
    return `${whole}.${fracStr}`;
  } catch {
    return String(wei);
  }
}

function repoFrom(url) {
  const m = /github\.com\/([A-Za-z0-9_.\-]+)\/([A-Za-z0-9_.\-]+)\//.exec(url || '');
  if (!m) return '';
  return `${m[1]}/${m[2]}`;
}

export default function BountyCard({ b, dense }) {
  const repo = repoFrom(b.issue_url);
  return (
    <Link to={`/bounty/${b.id}`} className={'bcard' + (dense ? ' bcard--dense' : '')}>
      <div className="bcard__head">
        <span className={`pill pill--${b.status}`}>{b.status.replace('_', ' ')}</span>
        <span className="bcard__id">#{b.id}</span>
        {b.assignee ? (
          <span className="pill pill--tag" title={b.assignee}>
            assigned {short(b.assignee)}
          </span>
        ) : (
          <span className="pill pill--tag pill--open">open to all</span>
        )}
        <span className="bcard__amount">{formatGen(b.amount)} GEN</span>
      </div>
      <div className="bcard__title">
        {repo || 'unknown repo'}
        <span className="bcard__issue">
          {b.issue_url.replace(/^https:\/\/github\.com\//, '')}
        </span>
      </div>
      <div className="bcard__meta">
        <span>sponsor {short(b.sponsor)}</span>
        {b.claimer && <span>· claimer {short(b.claimer)}</span>}
        {b.quality && <span>· quality {b.quality}</span>}
        {b.head_sha && <span>· sha {b.head_sha.slice(0, 7)}</span>}
      </div>
      {b.reason && (
        <div className="bcard__reason" title={b.reason}>
          <span className="bcard__reason-label">verdict</span>
          <span className="bcard__reason-text">{b.reason}</span>
        </div>
      )}
    </Link>
  );
}
