import { Link, NavLink } from 'react-router-dom';
import { CONTRACT_ADDRESS, CHAIN } from '../client.js';
import { useWallet } from '../hooks/useWallet.js';

function short(v) {
  if (!v) return '';
  return v.slice(0, 6) + '…' + v.slice(-4);
}

export default function TopNav({ active }) {
  const { account, connect } = useWallet();
  const configured =
    CONTRACT_ADDRESS &&
    CONTRACT_ADDRESS !== '0x0000000000000000000000000000000000000000';

  return (
    <header className="topnav">
      <div className="topnav__inner">
        <Link to="/" className="brand">
          <span className="brand__glyph">◆</span>
          <span className="brand__name">bountybot</span>
          <span className="brand__version">v0.3.2</span>
        </Link>
        <nav className="topnav__links">
          <NavLink to="/app" end className={({ isActive }) => 'topnav__link' + (isActive || active === 'dashboard' ? ' is-active' : '')}>
            dashboard
          </NavLink>
          <NavLink to="/create" className={({ isActive }) => 'topnav__link' + (isActive || active === 'create' ? ' is-active' : '')}>
            new bounty
          </NavLink>
          <a
            href={`https://genlayer-explorer.vercel.app/address/${CONTRACT_ADDRESS}`}
            target="_blank"
            rel="noreferrer"
            className="topnav__link topnav__link--muted"
            title={CONTRACT_ADDRESS}
          >
            {configured ? short(CONTRACT_ADDRESS) : 'contract: not set'}
          </a>
        </nav>
        <div className="topnav__wallet">
          {account ? (
            <span className="wallet-chip">
              <span className="wallet-chip__dot" />
              <code>{short(account)}</code>
              <span className="wallet-chip__chain">· {CHAIN.name}</span>
            </span>
          ) : (
            <button className="btn btn-primary btn-small" onClick={connect}>
              connect metamask
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
