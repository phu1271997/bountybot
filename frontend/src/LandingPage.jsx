import { Link } from 'react-router-dom';
import { CONTRACT_ADDRESS, CHAIN } from './client.js';

function short(addr) {
  if (!addr) return '';
  return addr.slice(0, 6) + '…' + addr.slice(-4);
}

const HOW_STEPS = [
  {
    tag: 'step_01',
    title: 'Sponsor posts a bounty',
    body:
      'Paste a GitHub issue URL, lock GEN into the contract. The bounty appears on-chain and is open to anyone.',
    code: 'create_bounty("github.com/org/repo/issues/42")',
  },
  {
    tag: 'step_02',
    title: 'Contributor submits a PR',
    body:
      'Anyone can claim the bounty by attaching a Pull Request URL. Only github.com issue and PR URLs are accepted.',
    code: 'submit_claim(bounty_id, "github.com/org/repo/pull/99")',
  },
  {
    tag: 'step_03',
    title: 'AI validators judge on-chain',
    body:
      'The contract fetches the issue page, the PR page, and the raw diff via gl.nondet.web.render. Validator LLMs independently vote.',
    code: 'gl.vm.run_nondet(leader_fn, validator_fn)',
  },
  {
    tag: 'step_04',
    title: 'Payout runs itself',
    body:
      'HIGH quality → 100% payout. MID → 60% + 40% refund. LOW → full refund. Verdict and reason are stored on-chain, forever auditable.',
    code: 'emit_transfer(value=u256(payout))',
  },
];

const WHY = [
  {
    icon: '⌥',
    title: 'No maintainer approval bottleneck',
    body:
      'Whether the PR fixes the issue is decided by validator consensus, not by a single reviewer who might be asleep, biased, or gone.',
  },
  {
    icon: '⌘',
    title: 'The judgement is on-chain',
    body:
      'Off-chain AI would require a trusted operator — the exact middleman the bounty is trying to remove. GenLayer runs the vote at the consensus layer.',
  },
  {
    icon: '≋',
    title: 'Direct web reads, no oracle',
    body:
      'gl.nondet.web.render lets the contract read github.com itself. There is no Chainlink, no Reality.eth, no relayer.',
  },
];

export default function LandingPage() {
  return (
    <div className="landing">
      <div className="landing__grid" aria-hidden="true" />

      <header className="landing__nav">
        <div className="brand">
          <span className="brand__glyph">◆</span>
          <span className="brand__name">bountybot</span>
          <span className="brand__version">v0.2.0</span>
        </div>
        <nav className="nav-links">
          <a href="#how" className="nav-link">how it works</a>
          <a href="#why" className="nav-link">why GenLayer</a>
          <a
            href="https://github.com/phu1271997/bountybot"
            target="_blank"
            rel="noreferrer"
            className="nav-link"
          >
            github
          </a>
          <Link to="/app" className="btn btn-primary btn-small">launch app →</Link>
        </nav>
      </header>

      <section className="hero">
        <div className="hero__terminal">
          <div className="hero__terminal-bar">
            <span className="dot dot--red" />
            <span className="dot dot--yellow" />
            <span className="dot dot--green" />
            <span className="hero__terminal-title">bounty.sh</span>
          </div>
          <div className="hero__terminal-body">
            <p className="term-line"><span className="term-prompt">$</span> gh issue view 42 --repo org/repo</p>
            <p className="term-out">Bug: null pointer in login flow when email empty</p>
            <p className="term-line"><span className="term-prompt">$</span> gh pr view 99 --repo org/repo</p>
            <p className="term-out">Guard against empty email + regression test</p>
            <p className="term-line"><span className="term-prompt">$</span> bountybot adjudicate 1</p>
            <p className="term-out term-out--muted">→ fetching issue…</p>
            <p className="term-out term-out--muted">→ fetching PR .patch, pinning SHA…</p>
            <p className="term-out term-out--muted">→ fetching commit/&lt;sha&gt;.patch (immutable)…</p>
            <p className="term-out term-out--muted">→ 5 validator LLMs voting…</p>
            <p className="term-out term-out--ok">✓ verdict: HIGH · payout 100% released to 0x0F73…4089</p>
          </div>
        </div>
        <div className="hero__pitch">
          <span className="tag-chip">TRACK · Agentic Economy + Future of Work</span>
          <h1>
            Get paid for<br />
            open source.<br />
            <span className="hero__accent">Trustlessly.</span>
          </h1>
          <p className="hero__lead">
            BountyBot is a bounty market on GenLayer studionet. Sponsors lock GEN against a
            GitHub issue. A contributor claims it with a PR. Validator LLMs read the diff on-chain
            and decide together whether it actually fixes the issue. Payout runs itself.
          </p>
          <div className="hero__cta">
            <Link to="/app" className="btn btn-primary">launch app →</Link>
            <a
              href="https://github.com/phu1271997/bountybot"
              target="_blank"
              rel="noreferrer"
              className="btn btn-ghost"
            >
              view source
            </a>
          </div>
          <p className="hero__meta">
            deployed at <code>{short(CONTRACT_ADDRESS)}</code> · chain{' '}
            <code>{CHAIN.name}</code>
          </p>
        </div>
      </section>

      <section className="section" id="how">
        <div className="section__lead">
          <span className="section__eyebrow">// flow</span>
          <h2>How the bounty settles</h2>
          <p>
            Four steps, all on-chain, no off-chain relayer in the loop. The interesting one is
            step three — the validator vote — because that is the piece Solidity cannot do.
          </p>
        </div>
        <div className="steps">
          {HOW_STEPS.map((s) => (
            <article key={s.tag} className="step">
              <span className="step__tag">{s.tag}</span>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
              <code className="step__code">{s.code}</code>
            </article>
          ))}
        </div>
      </section>

      <section className="section section--why" id="why">
        <div className="section__lead">
          <span className="section__eyebrow">// why GenLayer</span>
          <h2>Why not just a normal bounty tool?</h2>
        </div>
        <div className="why-grid">
          {WHY.map((w) => (
            <article key={w.title} className="why-card">
              <span className="why-card__icon">{w.icon}</span>
              <h3>{w.title}</h3>
              <p>{w.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section section--consensus">
        <div className="consensus-card">
          <span className="section__eyebrow">// validator logic</span>
          <h2>The validator checks meaning, not shape</h2>
          <p>
            Two validator LLMs will phrase their reasoning differently. That is not a
            disagreement. The contract compares the extracted verdict —{' '}
            <code>fixes_issue</code> and <code>quality</code> — and ignores the free-text
            reason. Two validators that produce different <code>quality</code> tiers fail
            consensus and the bounty stays locked.
          </p>
          <pre className="code-block">
{`def validator_fn(leader_res):
    if not isinstance(leader_res, gl.vm.Return):
        return False
    proposed = leader_res.calldata
    mine = leader_fn()
    return (
        bool(mine["fixes_issue"]) == bool(proposed["fixes_issue"])
        and mine["quality"] == proposed["quality"]
    )`}
          </pre>
        </div>
      </section>

      <footer className="landing__footer">
        <div className="footer-cols">
          <div>
            <span className="brand">
              <span className="brand__glyph">◆</span>
              <span className="brand__name">bountybot</span>
            </span>
            <p className="footer-blurb">
              Built for the GenLayer Builders track. Powered by Intelligent Contracts, run
              on studionet.
            </p>
          </div>
          <div>
            <h4>Contract</h4>
            <p>
              <a
                href={`https://genlayer-explorer.vercel.app/address/${CONTRACT_ADDRESS}`}
                target="_blank"
                rel="noreferrer"
              >
                <code>{CONTRACT_ADDRESS}</code>
              </a>
            </p>
            <p>
              Chain: <code>{CHAIN.name}</code> · id <code>{CHAIN.id}</code>
            </p>
          </div>
          <div>
            <h4>Links</h4>
            <ul>
              <li>
                <a href="https://github.com/phu1271997/bountybot" target="_blank" rel="noreferrer">
                  GitHub
                </a>
              </li>
              <li>
                <a href="https://genlayer.com" target="_blank" rel="noreferrer">
                  GenLayer
                </a>
              </li>
              <li>
                <a href="https://docs.genlayer.com" target="_blank" rel="noreferrer">
                  Docs
                </a>
              </li>
            </ul>
          </div>
        </div>
        <p className="footer-copy">© 2026 · Submitted to the GenLayer Foundation Builders program</p>
      </footer>
    </div>
  );
}
