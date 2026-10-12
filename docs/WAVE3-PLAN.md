# NightPoll Wave 3 plan: Lace browser voting + DUST-sponsored votes

Branch: `wave3`. Goal: close **THREAT-MODEL limitation #1 (fee-payer linkability)** and let members vote from
the browser. Ground rules: the Wave 2 deployment (Preview contract `03aa4564…4ca90a`), `gh-pages`, the video
and the Pages links stay as they are. Wave 3 work is additive and goes on `wave3`. Throwaway wallets only.

## 1. Findings (researched 2026-10-12)

### a) Lace DApp connector (browser dApp: balance, prove, submit)
- API: `@midnight-ntwrk/dapp-connector-api` **4.0.1** (already a root dependency of this repo). The wallet
  injects itself under `window.midnight.<id>` (Lace: `window.midnight.mnLace`). `connect(networkId)` returns a
  `ConnectedAPI` with:
  - `getConfiguration()`: indexer, indexer WS, node, `networkId`; `proverServerUri` is optional and deprecated
  - `getConnectionStatus()`
  - `getShieldedAddresses()`, `getUnshieldedAddress()`, `getDustAddress()`
  - `getShieldedBalances()`, `getUnshieldedBalances()`, `getDustBalance()`
  - `balanceUnsealedTransaction(tx, { payFees? })`: for contract calls; takes a serialized
    `Transaction<SignatureEnabled, Proof, PreBinding>` and returns `{ tx }`, ready to submit
  - `balanceSealedTransaction(tx, { payFees? })`
  - `submitTransaction(tx)`: "effectively using wallet as a relayer"
  - `getProvingProvider(keyMaterialProvider)`, `signData()`, `makeTransfer()`, `makeIntent()`, `hintUsage()`

  Sources: https://docs.midnight.network/api-reference/dapp-connector,
  https://docs.midnight.network/api-reference/dapp-connector/type-aliases/WalletConnectedAPI,
  https://cdn.jsdelivr.net/npm/@midnight-ntwrk/dapp-connector-api@4.0.1/dist/api.d.ts,
  https://docs.midnight.network/relnotes/dapp-connector-api/dapp-connector-api-4-0-0
- **Lace does not implement `getProvingProvider()` or `signData()`.** Proving with Lace needs a **local proof
  server** (Lace Settings → Midnight → Local, `http://localhost:6300`). The recommended pattern is to
  feature-detect `getProvingProvider` (1AM has it) and otherwise fall back to `httpClientProofProvider`. Lace's
  service worker blocks direct requests to `localhost`, so production dApps proxy the proof server through
  their own origin (`/proof-server`).
  Sources: https://docs.midnight.network/sdks/community/wallets/community-wallets-integration,
  https://forum.midnight.network/t/lace-wallet-doesnt-implement-getprovingprovider-expected-behavior-or-version-gap/1213,
  https://docs.midnight.network/api-reference/midnight-js/@midnight-ntwrk/midnight-js-dapp-connector-proof-provider/functions/dappConnectorProvingProvider
- Consequence for NightPoll: in-browser voting = build the `vote()` call with midnight-js in the page, prove it
  through the local proof server (Lace) or `getProvingProvider` (1AM), then hand it to the wallet. The member's
  `sk` lives in browser private state, so the dApp must manage it (export/backup UX).

### b) DUST sponsorship / fee delegation
- **Supported natively at the transaction level; the sponsor is a wallet or service (a relayer pattern), not a
  contract feature.** Docs: "Smart contracts do not hold or spend DUST in the current protocol; sponsorship is a
  wallet-side mechanism." The flow:
  1. The user proves the call.
  2. The user balances only `['shielded', 'unshielded']`, signs and **binds** (`FinalizedTransaction`).
  3. The user sends the hex to the sponsor.
  4. The sponsor runs `balanceFinalizedTransaction(tx, …, { tokenKindsToBalance: ['dust'] })`, signs its own
     additions and submits.

  Because the tx is bound, the sponsor can't change the call, and it never sees the user's secret.
  Reference implementation: `midnightntwrk/example-private-party` (`src/sponsor.ts`, `src/wallet.ts`,
  `scripts/sponsor-service.ts`). It pins the same versions we use (midnight-js 4.1.1, wallet-sdk 1.2.0,
  ledger-v8 8.1.0). Our installed `wallet-sdk-facade` already has `balanceFinalizedTransaction` and
  `tokenKindsToBalance`.
  Sources: https://docs.midnight.network/guides/dust-sponsorship,
  https://github.com/midnightntwrk/example-private-party (src/sponsor.ts, scripts/sponsor-service.ts)
- Fit with NightPoll: the contract already authenticates by secret (membership proof + nullifier), not by fee
  payer, which is what the guide requires. **No contract change is needed**, so the deployed Preview contract
  stays as it is and can be sponsored.
- The connector side: `balanceUnsealedTransaction(tx, { payFees: false })` should let Lace bind a call
  without paying fees, giving the sponsor-ready tx. To verify with a real Lace build (milestone M3).

## 2. Architecture

```
 browser (member)                                   relayer (sponsor service)                 Midnight
 ────────────────                                   ─────────────────────────                 ────────
 sk in browser private state
 build vote(k) call (midnight-js, indexer state)
 prove: Lace → local proof server (/proof-server proxy)
        1AM  → getProvingProvider
 bind without fees:
   Lace  balanceUnsealedTransaction(tx,{payFees:false})
   or SDK balanceUnboundTransaction(['shielded','unshielded'])
 POST /sponsor/vote { tx: hex } ───────────────────► deserialize (signature, proof, binding)
                                                    policy: 1 intent, 1 call, contract ∈ allowlist,
                                                            entry point ∈ {vote[, register]}, no token
                                                            movement, no DUST actions, size cap
                                                    rate limit per client + global budget
                                                    balanceFinalizedTransaction(['dust']) ──► submit
                                         ◄───────── { txId }                                  tally += 1
```

What this fixes and what it does not:
- The member's own wallet never pays, so **register and vote can't be linked on chain through the fee payer**
  (both are sponsored, from one shared relayer wallet).
- The relayer learns network metadata (client IP, request timing). Members should use a different relayer or a
  network-level privacy layer if that matters, and the relayer must not log IPs beyond rate limiting.
  Limitations #3 (timing) and #4 (small set) remain; batching (M5) helps.
- Abuse: the relayer only pays for `vote` (and optionally `register`) on allowlisted polls. Double votes are
  stopped by the contract (and fail at proving time, so they cost the relayer nothing). Non-member votes fail
  at proving time too. The remaining spend risk is open-registration spam, handled by rate limits and an
  optional per-poll budget.

## 3. Feasible on Preview now

| Piece | Status on Preview |
|---|---|
| Sponsored `vote` / `register` from the CLI (Node), relayer = throwaway wallet with NIGHT registered for DUST | Feasible now. Same SDK calls as example-private-party. Needs Preview tNIGHT from the faucet for a new throwaway relayer wallet (or reuse the existing throwaway Preview demo wallet, if Orange agrees) |
| Relayer HTTP service with policy + rate limits | Built on `wave3` (see §5). Can run anywhere Node runs |
| Browser read-only viewer | Live (Wave 2) |
| Browser proving + Lace binding + POST to relayer | Feasible, but needs a **Lace install and a Lace wallet** (manual, by a human; Lace has to be set up by hand with a throwaway wallet) and a local proof server |
| Contract changes | Not needed |

## 4. Milestones (effort estimates, single dev)

| # | Milestone | Effort | Demo |
|---|---|---|---|
| M1 | Relayer core: policy, HTTP service, sponsor halves in the wallet wrapper, unit tests | 0.5 d (**done in this run**) | `npm test` |
| M2 | Sponsored register + vote end to end on the local `undeployed` chain from an **empty** voter wallet; negative cases (double vote, other contract, other circuit) | 0.5 d (spike script on `wave3`) | `npm run spike -w @nightpoll/cli` |
| M3 | Same on Preview: fund a throwaway relayer wallet, run the relayer against a **new** Wave 3 poll (the Wave 2 contract stays untouched), publish tx hashes, show on the explorer that the vote tx carries only the relayer's DUST spend | 0.5–1 d (faucet + DUST generation wait) | explorer links — **DONE 2026-10-13** (see §9) |
| M4 | Browser voting: `ui/` gets "Join (generate key) → Register → Vote". Proving via local proof server proxy (Lace) or `getProvingProvider` (1AM), binding via `balanceUnsealedTransaction({payFees:false})`, submission via relayer. Key backup/export | 2–3 d | screen recording with a throwaway Lace wallet — **DONE 2026-10-13** (see §9) |
| M5 | Hardening: per-poll budget, batching/random delay of submissions (timing), relayer logging policy (no IPs), docs + threat-model update | 1 d | THREAT-MODEL v2 |
| M6 | Credential-gated registration (selective disclosure) | 3+ d, stretch; needs contract v2 (new deployment, separate from Wave 2) | — |

## 5. Smallest demoable slice (built on `wave3`)

"A member whose wallet holds **zero** NIGHT and zero DUST registers and votes. Every fee is paid by the
relayer, and the policy refuses anything that isn't a `register`/`vote` on the allowlisted poll."

- `cli/src/relayer/policy.ts`: `summarize(tx)` and `checkPolicy(...)` as pure functions, plus `RateLimiter`.
- `cli/src/relayer/server.ts`: `POST /sponsor/vote` and `GET /health`. Submissions are serialized (avoids
  DUST double-spend error 196); errors map to 400/403/413/429/502.
- `cli/src/relayer/sponsor.ts`: the wallet-backed `Sponsor` (deserialize the bound tx, policy summary,
  `addDustFeesAndFinalize`, submit).
- `cli/src/wallet.ts` (additive): `balanceOwnValueAndFinalize` (user side), `addDustFeesAndFinalize`
  (sponsor side), `dustBalance`.
- `cli/src/relayer/main.ts`: runs the service. It refuses mainnet and needs an explicit throwaway relayer seed
  (except the public genesis seed on `undeployed`).
- `cli/src/relayer/spike-localnet.ts`: the end-to-end slice on the local chain.
- Tests: `cli/src/test/relayer-policy.test.ts`, `cli/src/test/relayer-server.test.ts`. `npm test` now runs the
  contract and CLI suites.

## 6. Blockers and open questions
- **Lace in the browser needs a human**: installing the extension, creating a throwaway wallet and approving
  connect/sign prompts can't be done by the bot (no logins or real-wallet signatures allowed). M4 needs Orange
  or money for a short manual session, or 1AM as an alternative.
- Whether Lace's `balanceUnsealedTransaction(tx, { payFees: false })` returns a tx the sponsor can top up with
  `balanceFinalizedTransaction(['dust'])`. The docs suggest yes; to verify in M4.
- Preview tNIGHT for a relayer wallet (faucet, then a DUST generation wait of hours).

## 7. Spike result: M2 passed on localnet (2026-10-12 22:49 JST)
- Voter wallet: fresh random seed with **0 unshielded / 0 DUST** before and after.
- Poll `9fd10df3…07dcd1` (local chain only).
- Sponsored `register`: 5506 B, policy ok, tx `000e4d85…569124`.
- Sponsored `vote`: 5452 B, policy ok, tx `0022b121…b18a`.
- Tally `[0,0,1]`.
- Double vote rejected at proving time (`NightPoll: already voted`), so the relayer paid nothing for it.
- Also confirmed: the voter-side `balanceUnboundTransaction(['shielded','unshielded'])` + sign + finalize works
  with an empty wallet.

## 8. M4 status: browser vote page built (2026-10-12 23:1x JST)
- `ui/vote.html` + `ui/src/vote/*`:
  - Connects Lace through dapp-connector v4, Preview only, connector API 4.x only.
  - Proves through the same-origin `/proof-server` vite proxy; ZK artifacts are served at `/zk` from the
    committed `ui/zk-artifacts`.
  - The vote key stays in browser localStorage, with backup/import.
  - Register/vote buttons. Fee modes: (a) wallet pays, (b) relayer pays. Mode (b) tries Lace
    `payFees:false`, then a local `tx.bind()`, then (after the user confirms) falls back to (a).
  - Refuses the Wave 2 demo poll.
- New Wave 3 test poll on Preview: `a0164789f5836b340e0cf96b3e2d94a109de43ed5725f1db0deb390ee179768c`
  (tx `6a7df865…e173`, block 1265681, open registration, 3 options).
- Headless checks on the box (fake connector, real Preview indexer, real proof server via the proxy):
  - The page loads the poll and proves `register` in the browser (5431 B).
  - The fallback local bind works.
  - The real relayer HTTP/deserialize/policy layer (`relayer:dry`) accepts it (5502 B), with no submission.
  - 17 unit tests in `ui/src/vote/test`.
- Still unverified (needs real Lace): `balanceUnsealedTransaction(…, {payFees:false})` and the Lace approval
  prompts. See `docs/LACE-TEST-STEPS.md` part B.

## 9. M3 + M4 done: real Lace, sponsored, on Preview (2026-10-13 JST)
Test poll `a0164789f5836b340e0cf96b3e2d94a109de43ed5725f1db0deb390ee179768c` (new Wave 3 poll; Wave 2 contract untouched).

| Step | Tx | Block |
|---|---|---|
| `register`, sponsored (relayer paid DUST), sealed by Lace (`payFees:false`) | `003834870040feb389a944c1cc163ce87e1dd6c15284c6b2bc5b6a93221a844bb8` | 1266245 |
| `openVoting` (admin) | `0060623adcd64483a68a7dc52c8d07100390b364414f2150be4627ca08a9716415` | 1266664 |
| `vote` option 0, sponsored, sealed by Lace → tally `[1,0,0]` | `00c903265519aaf7696c189416b3b53aca2b982e1da0822f6069c8668c9fe441f0` | — |
| duplicate `vote` | rejected locally at proving: `failed assert: NightPoll: already voted`, no Lace popup | — |

- The Lace popup showed network `preview`, the `vote` entry point and the poll contract.
- `balanceUnsealedTransaction(…, {payFees:false})` works in real Lace, so the voter wallet pays nothing (DUST 0).
- Follow-up fixes: the vote button is now disabled once this browser key's vote nullifier is in the on-chain
  `nullifiers` set (computed locally, the secret never leaves the page). Connect now waits up to 3 s for Lace to
  inject `window.midnight` and logs each step and any timeout.
- 中文：M3（Preview 上的代付运行）和 M4（Lace 浏览器投票）已完成。voter 钱包 DUST 为 0，注册和投票的手续费都由
  relayer 支付，Lace 只做 `payFees:false` 封装。重复投票在本地证明阶段就被合约断言拒绝。详见 `docs/WAVE3-RESULTS.md`。
