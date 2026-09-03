import { Link } from 'react-router-dom';
import { CONTRACT_ADDRESS, CHAIN } from '../client.js';

function short(addr) {
  if (!addr) return '';
  return addr.slice(0, 6) + '…' + addr.slice(-4);
}

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="site-footer__grid">
        <div>
          <span className="brand">
            <span className="brand__glyph">◆</span>
            <span className="brand__name">bountybot</span>
          </span>
          <p className="site-footer__blurb">
            AI-adjudicated GitHub bounties. Sponsors lock GEN. Validator LLMs
            read the immutable commit patch on-chain, vote, and settle payout —
            no maintainer approval, no oracle.
          </p>
          <p className="site-footer__meta">
            Built for the GenLayer Foundation Builders track on studionet.
          </p>
        </div>
        <div>
          <h4>Product</h4>
          <ul>
            <li><Link to="/app">Dashboard</Link></li>
            <li><Link to="/create">Post a bounty</Link></li>
            <li><a href="#how">How it works</a></li>
            <li><a href="#security">Security model</a></li>
            <li><a href="#faq">FAQ</a></li>
          </ul>
        </div>
        <div>
          <h4>Contract</h4>
          <ul>
            <li>
              <a
                href={`https://genlayer-explorer.vercel.app/address/${CONTRACT_ADDRESS}`}
                target="_blank"
                rel="noreferrer"
              >
                <code>{short(CONTRACT_ADDRESS)}</code>
              </a>
            </li>
            <li>chain <code>{CHAIN.name}</code></li>
            <li>chainId <code>{CHAIN.id}</code></li>
            <li>
              <a href="https://genlayer-explorer.vercel.app" target="_blank" rel="noreferrer">
                Explorer
              </a>
            </li>
          </ul>
        </div>
        <div>
          <h4>Ecosystem</h4>
          <ul>
            <li><a href="https://github.com/phu1271997/bountybot" target="_blank" rel="noreferrer">Source on GitHub</a></li>
            <li><a href="https://genlayer.com" target="_blank" rel="noreferrer">GenLayer</a></li>
            <li><a href="https://docs.genlayer.com" target="_blank" rel="noreferrer">Developer docs</a></li>
            <li><a href="https://portal.genlayer.foundation" target="_blank" rel="noreferrer">Builders Portal</a></li>
            <li><a href="https://discord.gg/8Jm4v89VAu" target="_blank" rel="noreferrer">Discord</a></li>
          </ul>
        </div>
      </div>
      <p className="site-footer__copy">
        © 2026 · Submitted to the GenLayer Foundation Builders program. Not
        financial advice. Testnet deployment; do not use with real assets.
      </p>
    </footer>
  );
}
