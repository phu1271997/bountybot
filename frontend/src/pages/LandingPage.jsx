import { Link } from 'react-router-dom';
import Footer from '../components/Footer.jsx';
import { CONTRACT_ADDRESS, CHAIN } from '../client.js';
import { useBounties } from '../hooks/useBounties.js';

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

const HOW_STEPS = [
  {
    tag: 'step_01',
    title: 'Sponsor posts a bounty',
    body:
      'Paste a GitHub issue URL, lock GEN into the contract. Optional: pin the bounty to a specific contributor wallet (direct assignment) so nobody can race in.',
    code: 'create_bounty("github.com/org/repo/issues/42", assignee="0x…")',
  },
  {
    tag: 'step_02',
    title: 'Contributor submits a PR',
    body:
      'The PR must live in the same repo as the issue, and one of its commits must contain the claimer wallet address. Comments and PR descriptions are ignored — anyone can plant those.',
    code: 'submit_claim(bounty_id, "github.com/org/repo/pull/99")',
  },
  {
    tag: 'step_03',
    title: 'AI validators judge on-chain',
    body:
      'The contract fetches the issue, the PR .patch, and the SHA-pinned commit patch (immutable). Validator LLMs vote independently. The verdict compares meaning, not phrasing.',
    code: 'gl.vm.run_nondet(leader_fn, validator_fn)',
  },
  {
    tag: 'step_04',
    title: 'Payout runs itself',
    body:
      'HIGH → 100% payout. MID → 60% payout + 40% refund. LOW or identity-not-bound → full refund. Verdict, reason, and pinned SHA are stored on-chain forever.',
    code: 'emit_transfer(value=u256(payout))',
  },
];

const GUARDS = [
  {
    tag: 'GUARD 01',
    title: 'Wallet bound to SHA-pinned commit',
    body:
      'The claiming wallet must appear inside github.com/owner/repo/commit/<sha>.patch — a git commit message the PR contributor authored, cryptographically bound to the head commit SHA. Comments, PR descriptions, review bodies are ignored.',
  },
  {
    tag: 'GUARD 02',
    title: 'Same-repo requirement',
    body:
      'The issue URL and PR URL are parsed into owner/repo tuples at submit_claim. If they differ, the claim is rejected before any adjudication side effects run — a PR from org/other-repo can never settle a bounty in org/repo.',
  },
  {
    tag: 'GUARD 03',
    title: 'All-evidence-or-revert',
    body:
      'adjudicate() reverts unless the issue page, the PR patch, a parseable commit SHA, and the SHA-pinned commit patch are all retrieved. Partial or mismatched evidence can never settle; the bounty stays CLAIMED so anyone can retry.',
  },
];

const USE_CASES = [
  {
    icon: '⛓',
    title: 'Open-source maintainers',
    body: 'Post bounties on issues you can\'t triage yourself. Let AI judgement replace maintainer review; you keep the merge decision.',
  },
  {
    icon: '⌐',
    title: 'Grant programs',
    body: 'Escrow milestone payouts against public deliverables. When the PR lands, payout releases automatically — no ops overhead.',
  },
  {
    icon: '☰',
    title: 'DAO treasury ops',
    body: 'Move bug-bounty budget on-chain. Every settlement is auditable: verdict, reason, and pinned SHA are visible in the record.',
  },
  {
    icon: '✵',
    title: 'AI agent economy',
    body: 'When AI agents open PRs, use BountyBot to reward the ones that actually fix issues. Direct assignment prevents copycats.',
  },
];

const COMPARE = [
  { label: 'PR judged by', trad: 'a single maintainer', ai_off: 'a trusted operator', bb: 'validator LLM consensus, on-chain' },
  { label: 'Payout trigger', trad: 'manual review + wire', ai_off: 'operator signs, transfers', bb: 'contract settles atomically' },
  { label: 'Data source', trad: 'human reading', ai_off: 'centralized scraper', bb: 'gl.nondet.web.render on-chain' },
  { label: 'Copied-PR attack', trad: 'hard to detect', ai_off: 'depends on operator', bb: 'SHA-pinned commit binding blocks it' },
  { label: 'Diff mutability', trad: 'n/a', ai_off: 'trusts current .diff', bb: 'pinned to head commit SHA — immutable' },
  { label: 'Adjudication cost', trad: 'time, attention', ai_off: 'ops + API keys', bb: 'gas + validator inference' },
];

const FAQ = [
  {
    q: 'Why not just use GitHub Sponsors or Gitcoin?',
    a: 'Both require a trusted party to decide whether the PR fixes the issue. BountyBot replaces that party with validator LLM consensus recorded on-chain. Payout is atomic with the verdict.',
  },
  {
    q: 'What stops someone claiming with a PR they didn\'t write?',
    a: 'The contract binds the claim to a wallet address that must appear inside the SHA-pinned commit patch. Only the PR author can put text into a commit message. Copied-PR attacks refund the sponsor 100% and reject.',
  },
  {
    q: 'What if the PR gets force-pushed after I claim?',
    a: 'Adjudication parses the head SHA from the PR patch at fetch time and pins the evidence to that specific commit. The commit content is immutable — its hash would change if anyone edited it, and re-adjudication would use the new head.',
  },
  {
    q: 'Can I pin a bounty to a specific contributor?',
    a: 'Yes. On create_bounty pass the contributor\'s wallet as the assignee argument. Only that wallet may submit_claim. Leave it empty for open bounties.',
  },
  {
    q: 'What does the LLM actually see?',
    a: 'The issue page text and the SHA-pinned commit patch (commit message + diff). It returns a JSON verdict: fixes_issue, quality (LOW/MID/HIGH), reason. Validators compare only the structured fields — free-text reason is ignored.',
  },
  {
    q: 'What happens if the LLM disagrees between validators?',
    a: 'Consensus fails and the bounty stays CLAIMED. Anyone can retry adjudication. No partial payout on disagreement.',
  },
];

export default function LandingPage() {
  const { total, locked, stats } = useBounties(30_000);
  return (
    <div className="landing">
      <div className="landing__grid" aria-hidden="true" />

      <header className="landing__nav">
        <Link to="/" className="brand">
          <span className="brand__glyph">◆</span>
          <span className="brand__name">bountybot</span>
          <span className="brand__version">v0.3.2</span>
        </Link>
        <nav className="nav-links">
          <a href="#how" className="nav-link">how it works</a>
          <a href="#security" className="nav-link">security</a>
          <a href="#compare" className="nav-link">compare</a>
          <a href="#faq" className="nav-link">faq</a>
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
        <div className="hero__pitch">
          <span className="tag-chip">TRACK · Agentic Economy + Future of Work</span>
          <h1>
            Get paid for<br />
            open source.<br />
            <span className="hero__accent">Trustlessly.</span>
          </h1>
          <p className="hero__lead">
            BountyBot is a bounty market on GenLayer studionet. Sponsors lock GEN against a
            GitHub issue. Validator LLMs read the SHA-pinned commit patch on-chain and vote
            on whether the PR actually fixes it. Payout settles atomically with the verdict.
          </p>
          <div className="hero__cta">
            <Link to="/app" className="btn btn-primary">launch app →</Link>
            <Link to="/create" className="btn btn-ghost">post a bounty</Link>
          </div>
          <p className="hero__meta">
            deployed at{' '}
            <a href={`https://genlayer-explorer.vercel.app/address/${CONTRACT_ADDRESS}`} target="_blank" rel="noreferrer">
              <code>{short(CONTRACT_ADDRESS)}</code>
            </a>{' '}
            · chain <code>{CHAIN.name}</code>
          </p>
        </div>
        <div className="hero__terminal">
          <div className="hero__terminal-bar">
            <span className="dot dot--red" />
            <span className="dot dot--yellow" />
            <span className="dot dot--green" />
            <span className="hero__terminal-title">bounty.sh</span>
          </div>
          <div className="hero__terminal-body">
            <p className="term-line"><span className="term-prompt">$</span> bountybot post --issue org/repo#42 --amount 1</p>
            <p className="term-out term-out--ok">✓ bounty #17 posted · 1 GEN locked · assignee: open</p>
            <p className="term-line"><span className="term-prompt">$</span> bountybot claim 17 --pr org/repo#99</p>
            <p className="term-out term-out--muted">→ same-repo check…OK</p>
            <p className="term-out term-out--ok">✓ claim recorded for 0x0F73…4089</p>
            <p className="term-line"><span className="term-prompt">$</span> bountybot adjudicate 17</p>
            <p className="term-out term-out--muted">→ fetching issue page…</p>
            <p className="term-out term-out--muted">→ fetching PR .patch, pinning head SHA…</p>
            <p className="term-out term-out--muted">→ fetching commit/&lt;sha&gt;.patch (immutable)…</p>
            <p className="term-out term-out--muted">→ 5 validator LLMs voting…</p>
            <p className="term-out term-out--ok">✓ verdict: HIGH · 1 GEN payout to 0x0F73…4089</p>
          </div>
        </div>
      </section>

      <section className="hero-stats">
        <div className="hero-stats__item">
          <span className="hero-stats__value">{total}</span>
          <span className="hero-stats__label">bounties posted</span>
        </div>
        <div className="hero-stats__item">
          <span className="hero-stats__value">{formatGen(locked)}<em> GEN</em></span>
          <span className="hero-stats__label">in escrow now</span>
        </div>
        <div className="hero-stats__item">
          <span className="hero-stats__value">{stats.settled}</span>
          <span className="hero-stats__label">settled by AI vote</span>
        </div>
        <div className="hero-stats__item">
          <span className="hero-stats__value">3</span>
          <span className="hero-stats__label">security guards enforced</span>
        </div>
      </section>

      <section className="section section--problem">
        <div className="section__lead">
          <span className="section__eyebrow">// problem</span>
          <h2>Open-source bounties still need a trusted middleman.</h2>
          <p>
            You post a bug bounty. Someone submits a PR. Now what? A maintainer has to
            read it, judge it, and manually wire the reward. If they&apos;re busy, biased,
            or gone, the whole loop stalls. If you route it through an off-chain AI, the
            operator becomes the new middleman — the exact thing you were trying to remove.
          </p>
        </div>
      </section>

      <section className="section" id="how">
        <div className="section__lead">
          <span className="section__eyebrow">// flow</span>
          <h2>Four steps, all on-chain.</h2>
          <p>
            The interesting step is number three — the validator vote — because that&apos;s
            the piece Solidity cannot do.
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

      <section className="section section--why" id="security">
        <div className="section__lead">
          <span className="section__eyebrow">// security model</span>
          <h2>Three guards, each one closes an attack.</h2>
          <p>
            Each guard maps to a concrete finding from the previous review round. Together
            they neutralize copy-PR steals, copy-PR locks, force-push races, and cross-repo
            impersonation.
          </p>
        </div>
        <div className="why-grid">
          {GUARDS.map((g) => (
            <article key={g.tag} className="why-card">
              <span className="why-card__icon">{g.tag}</span>
              <h3>{g.title}</h3>
              <p>{g.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section section--consensus">
        <div className="consensus-card">
          <span className="section__eyebrow">// validator logic</span>
          <h2>Validators compare meaning, not shape.</h2>
          <p>
            Two validator LLMs phrase reasoning differently. That&apos;s not a
            disagreement. The contract compares the extracted verdict — <code>fixes_issue</code>,
            <code> quality</code>, <code>wallet_bound</code>, <code>head_sha</code> — and
            ignores the free-text reason. Validators that produce different verdicts fail
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
        and mine["wallet_bound"] == proposed["wallet_bound"]
        and mine["head_sha"] == proposed["head_sha"]
    )`}
          </pre>
        </div>
      </section>

      <section className="section" id="use-cases">
        <div className="section__lead">
          <span className="section__eyebrow">// who this is for</span>
          <h2>Built for the people already writing the check.</h2>
        </div>
        <div className="usecase-grid">
          {USE_CASES.map((u) => (
            <article key={u.title} className="usecase">
              <span className="usecase__icon">{u.icon}</span>
              <h3>{u.title}</h3>
              <p>{u.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section" id="compare">
        <div className="section__lead">
          <span className="section__eyebrow">// compare</span>
          <h2>vs. the maintainer, vs. off-chain AI.</h2>
        </div>
        <div className="compare-wrap">
          <table className="compare">
            <thead>
              <tr>
                <th></th>
                <th>Traditional bounty</th>
                <th>Off-chain AI arbiter</th>
                <th className="compare__ours">BountyBot on GenLayer</th>
              </tr>
            </thead>
            <tbody>
              {COMPARE.map((row) => (
                <tr key={row.label}>
                  <td className="compare__label">{row.label}</td>
                  <td>{row.trad}</td>
                  <td>{row.ai_off}</td>
                  <td className="compare__ours">{row.bb}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section section--howto" id="use">
        <div className="section__lead">
          <span className="section__eyebrow">// how to use</span>
          <h2>End-to-end, in five moves.</h2>
        </div>
        <ol className="howto">
          <li>
            <strong>Fund your wallet on studionet.</strong> Add chain id <code>61999</code>{' '}
            in MetaMask; transfer GEN from a pre-funded account in{' '}
            <a href="https://studio.genlayer.com" target="_blank" rel="noreferrer">Studio → Accounts</a>.
          </li>
          <li>
            <strong>Post a bounty.</strong> On <Link to="/create">/create</Link>, paste the
            GitHub issue URL, choose amount, decide whether to pin an assignee.
          </li>
          <li>
            <strong>Have the contributor claim.</strong> Their PR must live in the same
            repo, and one of its commits must contain the exact line{' '}
            <code>Bounty claim by: 0x…</code>.
          </li>
          <li>
            <strong>Adjudicate.</strong> Anyone can hit the button. Validator LLMs fetch,
            vote, and settle.
          </li>
          <li>
            <strong>Read the record.</strong> The verdict, reason, pinned SHA, payout, and
            refund are on-chain and auditable in the Explorer.
          </li>
        </ol>
      </section>

      <section className="section" id="faq">
        <div className="section__lead">
          <span className="section__eyebrow">// faq</span>
          <h2>Common questions.</h2>
        </div>
        <div className="faq">
          {FAQ.map((f, i) => (
            <details key={i} className="faq__item">
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="section section--cta">
        <div className="cta-card">
          <h2>Post your first bounty.</h2>
          <p>
            Costs a few cents of GEN. If nobody claims, cancel and get every unit back.
          </p>
          <div className="hero__cta">
            <Link to="/create" className="btn btn-primary">+ post a bounty</Link>
            <Link to="/app" className="btn btn-ghost">browse the board</Link>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
