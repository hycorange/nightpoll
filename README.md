# 🌙 NightPoll

**Anonymous community polls on Midnight with no double voting.** Members prove in zero knowledge that
they belong to the poll. A one-time nullifier stops anyone from voting twice. The chain only ever sees the
tally, never who voted for what.

Built for the Midnight Buildathon (AKINDO), Wave 2, by **hycorange**. License: Apache-2.0.

| | |
|---|---|
| Contract | [`contract/src/nightpoll.compact`](contract/src/nightpoll.compact) (Compact 0.31.1, 5 circuits, compiles with ZK keys) |
| Tests | 19 / 19 simulator tests pass (`npm test`) |
| End-to-end | passes on a local Midnight `undeployed` network (official node, indexer and proof-server binaries) |
| Preview testnet | contract address + tx hashes: see [Preview deployment](#preview-deployment), filled in by `scripts/demo.sh preview --readme` |
| UI | read-only poll viewer (`ui/`), reads the live ledger from the Preview indexer |
| Slide deck | [`docs/NightPoll-deck.pdf`](docs/NightPoll-deck.pdf) (8 slides: problem, solution, why Midnight, Preview demo, engineering, threat model + roadmap, adoption) |

---

## For judges: verify in ~10 minutes

```bash
git clone https://github.com/hycorange/nightpoll.git && cd nightpoll
source scripts/env.sh && npm install
npm run compact && npm test               # technical gate: contract compiles, 19 tests pass
scripts/demo.sh undeployed                # full e2e on a local chain, no faucet, prints a summary table
```

`scripts/demo.sh preview` runs the same flow on the public Preview testnet with a funded wallet. The
results are in [Preview deployment](#preview-deployment).

---

## Why this needs ZK and nullifiers

Online polls usually make you pick between two bad options:

- **Accountable but not private.** You log in, so the operator (or the chain) sees exactly who voted for what.
  People hold back on sensitive votes, for example in a DAO, a union, a workplace survey or a community moderation call.
- **Private but not accountable.** Anonymous forms can't stop ballot stuffing, and you have to trust whoever counts.

NightPoll gets both properties at once:

1. **Eligibility without identity.** To vote, a member proves *"my secret key belongs to one of the registered
   commitments"* with a Merkle-membership proof. The proof doesn't say which commitment.
2. **One person, one vote, still anonymous.** Each vote publishes `nullifier = H("nightpoll:nullifier:", pollId, sk)`.
   A second vote from the same key produces the same nullifier, and the contract rejects it. Commitments and
   nullifiers use different domain tags, so nobody can link a vote back to a registration.
3. **Verifiable tally.** The counts are public ledger state that only `vote()` can change, after all checks pass.
   Nobody has to trust a counter.

Midnight fits this well. The contract logic runs locally over **private state** (the member's secret key never
leaves their device), and the chain verifies a ZK proof of that run. Only the values the contract explicitly
`disclose()`s reach the **public ledger**. That's Midnight's dual-ledger model.

## How it works

```
 member device (private)                         Midnight public ledger
 ───────────────────────                         ──────────────────────
 sk  (LevelDB private state, never shared)
  │
  ├─ register():  c = H(member, pollId, sk) ──►  members  MerkleTree += c ; commitments += c
  │      (or admin addMember(c) for curated polls; member hands c over off-chain)
  │
  ├─ vote(k):     witness: Merkle path for c
  │               proves: path.leaf == H(member, pollId, sk)
  │                       root(path) ∈ members history
  │                       k < optionCount
  │               discloses: nul = H(nullifier, pollId, sk) ─►  nullifiers += nul (must be new)
  │                          k ──────────────────────────────►  tally[k] += 1 ; totalVotes += 1
  │
 admin (key-derived, H(admin, pollId, sk_admin))  openVoting() / closePoll():  REGISTRATION → VOTING → CLOSED
```

| Public (on chain) | Private (stays on the device) |
|---|---|
| question, option count, phase, admin key hash | each member's secret key |
| member commitments (opaque hashes), member count | which commitment belongs to which person |
| nullifiers (opaque, unlinkable to commitments) | which member cast which vote |
| per-option tally, total votes | the Merkle path used in each proof |

### Contract (`contract/src/nightpoll.compact`)

- Ledger: sealed `pollId`, `question`, `optionCount`, `selfRegistration`, `admin`. Plus `phase`,
  `members: HistoricMerkleTree<10, Bytes<32>>` (up to 1024 members), `commitments: Set`, `nullifiers: Set`,
  `tally: Map<Uint<8>, Counter>`, `totalVotes`, `memberCount`.
- Circuits:
  - `register()`: self-registration, only when `selfRegistration` is on.
  - `addMember(commitment)`: admin only, for curated communities.
  - `openVoting()` / `closePoll()`: admin-only phase changes.
  - `vote(choice)`: phase check, range check, membership, nullifier.
- Witnesses (`contract/src/witnesses.ts`): `localSecretKey()` and `findMembershipPath(c)`. The circuit
  re-checks everything they return, so a malicious witness can't forge membership. Tests cover a path taken
  from another tree and a path borrowed from another member.
- `HistoricMerkleTree` lets a vote proven against a slightly older root still verify while new members join.

### Architecture

```
contract/   Compact contract, witnesses, simulator + 19 vitest tests
cli/        TypeScript CLI (midnight-js 4.1.1, wallet-sdk 1.2.0):
            wallet · fund · deploy · register · commitment · add-member · open · vote · close · tally · e2e
            providers: level private-state (encrypted) · indexer public-data · http proof server · node-zk-config
ui/         React + Vite read-only viewer (indexer + compiled ledger() decoder)
scripts/    localnet.sh (node + indexer + proof server, no docker) · demo.sh · summary.mjs · fetch-image.sh
```

Each local identity (`--as alice`) gets its own secret key in the encrypted private-state store. The wallet
(official HD SDK seed) pays fees in DUST, which is generated by NIGHT registered for DUST generation. Proofs
are generated by a local proof server, and transactions go to the node.

---

## Quickstart

Prerequisites: Node ≥ 24.11 and the Compact toolchain (compiler 0.31.1). `scripts/env.sh` puts the user-local
installs on `PATH`. Docker is **not** required.

```bash
source scripts/env.sh
npm install
npm run compact          # compile contract + ZK keys (~15 s)
npm test                 # 19 simulator tests
```

### A. Local network (`undeployed`, pre-funded genesis wallet, no faucet)

```bash
# one-time: fetch the official images' binaries (digest-pinned, sha256-verified)
scripts/fetch-image.sh midnightntwrk/midnight-node sha256:b88c42f80c9ad2dfb8235de3343761b6b81a33508dee497ad0e59694ea65b168 midnight-node-0.22.3
scripts/fetch-image.sh midnightntwrk/indexer-standalone sha256:5d82fabe3228fcb7936febbf3fa7d6c713a3d68849ec9850cefaee3e61badf8f indexer-standalone-4.0.1
scripts/fetch-proof-server.sh

scripts/demo.sh undeployed   # starts node :9944, indexer :8088, proof server :6300 -> e2e -> summary -> stops them
```

If you have Docker, the official `midnight-local-dev` / `bboard-cli/compose.yml` stack works too. Run
`NP_NETWORK=undeployed npm run np -- e2e` against it.

### B. Preview testnet

```bash
npm run np -- wallet                 # creates .secrets/preview-wallet.seed (chmod 600), prints the mn_addr_preview1... address
# fund it at the Preview faucet (docs list https://midnight-tmnight-preview.nethermind.dev/ and faucet.preview.midnight.network)
scripts/demo.sh preview --readme     # proof server -> wait for NIGHT -> register for DUST -> e2e -> fill README table
```

The first Preview wallet sync takes about 20 minutes. After that the sync state is cached in `.secrets/state/`.

### Individual commands

```bash
npm run np -- deploy --question "Best day for the community call?" --options 3 [--closed]
npm run np -- register   --contract <addr> --as alice
npm run np -- commitment --contract <addr> --as carol           # carol hands this to the admin off-chain
npm run np -- add-member --contract <addr> --commitment <hex>   # --as admin (default)
npm run np -- open       --contract <addr>
npm run np -- vote       --contract <addr> --as alice --choice 0
npm run np -- close      --contract <addr>
npm run np -- tally      --contract <addr>
```

Add `--network preview|preprod|undeployed` (or set `NP_NETWORK`). Preprod needs a `BLOCKFROST_PROJECT_ID`.

---

## Step-by-step demo (what `e2e` does, and what you should see)

| # | Step | Who | Expected |
|---|---|---|---|
| 0 | Sync wallet; register NIGHT for DUST if needed | wallet | `synced: NIGHT=… DUST=…` |
| 1 | Deploy a 3-option poll with open registration | admin | `deployed NightPoll at <address>` |
| 2 | `register()` | alice, bob | `register:alice: tx … (block …)`, ledger `members: 1 → 2` |
| 3 | carol computes her commitment locally; admin calls `addMember(c)` | carol → admin | `carol commitment (sent to admin off-chain): …`, `members: 3` |
| 4 | `openVoting()` | admin | phase `VOTING` |
| 5 | `vote(0)`, `vote(2)`, `vote(2)` | alice, bob, carol | 3 nullifiers, tally `{0:1, 1:0, 2:2}` |
| 6 | alice tries `vote(1)` again | alice | **rejected**: `failed assert: NightPoll: already voted` |
| 7 | `closePoll()` | admin | phase `CLOSED`; final tally printed |

Real output from `scripts/demo.sh undeployed` (2026-10-11 16:01–16:04 UTC+8, local chain):

```
INFO: deploy: tx e8015cc5b92b18dafc21bca859c048138d5105898f2a0d93800930f8a8a57f01 (block 287)
INFO: register:alice: tx 8503c5076c16ce77a0e5018fd6b0d24efee90ac674508dc481b766e4ad51016e (block 294)
INFO: register:bob: tx 3ddf316ed9518ef12d965c8bb20f3bafd46475031df7b37f198b5a30bf8d94f8 (block 297)
INFO: addMember:carol: tx fab7aa14b5ddbcd8a5b70e26a7f70e568a3ed30524e71d397a30891c87604449 (block 300)
INFO: openVoting: tx d067df9065d98130701db203d6623c8be077eb7edfc7410db7d7c0155bdcefe9 (block 303)
INFO: vote:alice: tx ccab3fc5687c9bb5bb820997c29a8dcb486f0044e66c301ef40bc05edfd86f7d (block 306)
INFO: vote:bob: tx ba371a5f25353deb0e8d7abbb2eddf4aff2c01b91c0b46e7d5f2b4f583e247ac (block 310)
INFO: vote:carol: tx b8add4bf73cb8cd2f4621674c81956a4550ab027a413d86103e974846ab4c2ca (block 313)
INFO: closePoll: tx 8db20140ae33cd4f9a28114f779f6a27bc6c5235898db0a67024253d5bde4b26 (block 316)
RESULT {"contract":"cf1f689a…6f701d","phase":"CLOSED","members":"3","totalVotes":"3","nullifiers":"3","tally":{"0":"1","1":"0","2":"2"}}
doubleVote: rejected: ... failed assert: NightPoll: already voted
```

(The demo names voters so you can follow along. On chain, a vote tx carries a proof and a nullifier, not a name.)

<a id="preview-deployment"></a>
## Preview deployment

Filled in by `scripts/demo.sh preview --readme` once the Preview wallet is funded.

<!-- PREVIEW-RESULTS:START -->
**Network:** `preview` · **run:** 2026-10-11T15:47:10.194Z → 2026-10-11T15:51:33.524Z (UTC)

**Contract address:** [`03aa456490ba4833c92a5fd107ffd9de6543e5cbfff5685dce99e5d92a4ca90a`](https://preview.midnightexplorer.com/contracts/03aa456490ba4833c92a5fd107ffd9de6543e5cbfff5685dce99e5d92a4ca90a)

| Step | Tx hash | Block |
|---|---|---|
| Register NIGHT for DUST (fees) | [`9d338404008ff18e…`](https://preview.midnightexplorer.com/transactions/9d338404008ff18ecb224002e8323dddc9371756f6ffd58a2c95888ba13e4f59) | 1252173 |
| Deploy poll (3 options, open registration) | [`99bd34ed5c0cf769…`](https://preview.midnightexplorer.com/transactions/99bd34ed5c0cf769af24d16c13082c2f95f10dc68884ca168a2e6593c6b5c7d9) | 1252343 |
| alice self-registers (commitment only) | [`a37f7565e3d76d3d…`](https://preview.midnightexplorer.com/transactions/a37f7565e3d76d3dfba8b7d47206f918dabcd874ce53b6189df9cf48126cf96d) | 1252351 |
| bob self-registers | [`2cc1d773977b2a91…`](https://preview.midnightexplorer.com/transactions/2cc1d773977b2a914787c4ebfd77a294269911abf5e05bbeca54ba6487c4a408) | 1252355 |
| admin adds carol's off-chain commitment | [`41b5e45d03286e92…`](https://preview.midnightexplorer.com/transactions/41b5e45d03286e9242a09b611a0626e43f0fee99557bb67634c1210562ed8809) | 1252360 |
| admin opens voting | [`7912582deb76e9df…`](https://preview.midnightexplorer.com/transactions/7912582deb76e9df1845cf855af6c48451198edf3dddc525e3a0ae2b03d906b6) | 1252365 |
| anonymous vote #1 (option 0) | [`40de0a3c90d8f39f…`](https://preview.midnightexplorer.com/transactions/40de0a3c90d8f39f87dd5b09c7f1f44e103e144dd3d4671b7ed6f63f175085d5) | 1252370 |
| anonymous vote #2 (option 2) | [`088025fce8083534…`](https://preview.midnightexplorer.com/transactions/088025fce808353492b456bacff539c4c11271a6420e42d8f8626a795d13cbf8) | 1252374 |
| anonymous vote #3 (option 2) | [`5e9f6d015f51675e…`](https://preview.midnightexplorer.com/transactions/5e9f6d015f51675e0fe1929954a6118eedfde25632e8494f798715f76bc7fff3) | 1252378 |
| admin closes poll | [`5035a46d487f369b…`](https://preview.midnightexplorer.com/transactions/5035a46d487f369b9edeadd088087989a7d272f44293dd8af831a388f14eef15) | 1252383 |
| alice votes again (option 1) | **rejected before submission:** `NightPoll: already voted` | — |

**Final on-chain state:** phase `CLOSED`, 3 members, 3 votes, 3 nullifiers, tally #0=1 · #1=0 · #2=2
<!-- PREVIEW-RESULTS:END -->

Explorers: [Midnight Explorer (Preview)](https://preview.midnightexplorer.com/),
[Subscan](https://midnight-preview.subscan.io/). To view the poll in the UI, run `cd ui && npx vite build && npx vite preview`
and open `?contract=<address>`.

---

## Tests

`contract/src/test/nightpoll.test.ts` has 19 tests on the Compact simulator:
- init and constructor validation
- self and admin registration, duplicate registration, registration closing
- phase permissions and ordering
- tally correctness and nullifier recording
- double vote, including a second vote for a different option
- out-of-range option
- non-member, forged path from another tree, borrowed path
- voting after close
- no secret keys on the ledger
- commitments and nullifiers differ across polls

The CLI e2e above is the integration test against a real node, indexer and proof server.

## Privacy caveats (honest threat model)

- **Fee payer linkability.** Fees are paid in DUST by a wallet. If the same wallet sends a member's `register`
  and `vote`, an observer can link the two txs and learn who voted for what. In the demo, a single wallet pays
  for every identity. For real anonymity, the vote has to come from a wallet the member never used to register,
  or a sponsor or relayer has to pay the fee (see roadmap).
- **The choice is public.** Each vote tx shows which option it adds to (that's how the tally stays verifiable).
  Only the voter is hidden.
- **Timing and small sets.** With 3 members, or if votes go out right after registration, timing alone can
  reveal voters. Anonymity grows with the member set, and batching or delayed submission helps.
- **Admin power.** The admin controls the phases and, in curated mode, who joins. The admin can't vote for
  anyone else or see ballots, but can refuse to add members or close the poll early.
- **Key custody.** Losing the secret key means losing the ability to vote. Leaking it lets someone else use your
  vote. Keys live in the encrypted LevelDB private-state store.

## Roadmap

**Wave 3**
1. **Browser voting with Lace** (DApp connector 4.0.1). Register and vote from the UI, with the proof generated
   locally. Today the UI only reads.
2. **DUST fee sponsorship / relayer.** A sponsor pays the fee, so the voter's wallet never appears on chain.
   This closes the fee-payer link above. See Midnight's
   [DUST sponsorship guide](https://docs.midnight.network/guides/dust-sponsorship) and `example-private-party`.
3. **Credential-gated registration.** Prove a property ("member of X", "holds credential Y") with selective
   disclosure instead of trusting an admin list.
4. **Multi-question surveys and ranked choice**, with results revealed only after close (commit-reveal tallies).

**After the buildathon:** a hosted poll page for DAOs and communities (target users: DAO governance, unions,
employee pulse surveys, moderation votes), plus an SDK package so other dApps can embed one-person-one-vote checks.

---

## Engineering notes

<details><summary>Local Midnight network without Docker, and two SDK pitfalls we fixed</summary>

The local dev chain (`midnight-node` with `CFG_PRESET=dev`) starts with pre-funded genesis wallets, so
the whole flow runs without a faucet. To avoid needing Docker, we run the binaries from the official
Docker Hub images directly. `scripts/fetch-image.sh` pulls the linux/amd64 manifest by pinned digest,
checks the sha256 of the manifest, the config and every layer, and then unpacks the rootfs under `.tools/`.

| Image (same versions as `example-bboard/bboard-cli/compose.yml`) | amd64 manifest digest |
|---|---|
| `midnightntwrk/midnight-node:0.22.3` | `sha256:b88c42f80c9ad2dfb8235de3343761b6b81a33508dee497ad0e59694ea65b168` |
| `midnightntwrk/indexer-standalone:4.0.1` | `sha256:5d82fabe3228fcb7936febbf3fa7d6c713a3d68849ec9850cefaee3e61badf8f` |
| `midnightntwrk/proof-server:8.1.3` | `sha256:97143a11c72d1b4a1878ca929e43317332bf4c09808dfa735e9ef96ee7c2fe18` (`scripts/fetch-proof-server.sh`) |

```bash
source scripts/env.sh
scripts/fetch-image.sh midnightntwrk/midnight-node sha256:b88c42f80c9ad2dfb8235de3343761b6b81a33508dee497ad0e59694ea65b168 midnight-node-0.22.3
scripts/fetch-image.sh midnightntwrk/indexer-standalone sha256:5d82fabe3228fcb7936febbf3fa7d6c713a3d68849ec9850cefaee3e61badf8f indexer-standalone-4.0.1
scripts/fetch-proof-server.sh

scripts/localnet.sh start      # node :9944, indexer :8088, proof server :6300 (logs: .tools/localnet/*.log)
NP_NETWORK=undeployed scripts/capped.sh npm run -s np -- e2e    # or: npm run np -- e2e --network undeployed
scripts/localnet.sh status     # RSS per service
scripts/localnet.sh stop       # `wipe` also deletes chain data and the cached undeployed wallet state
```

- Each service runs under `nice -n 19 ionice -c3` with a wall-clock timeout (`LOCALNET_TTL`, default 4h) and an
  RSS watchdog that kills it above `LOCALNET_MAX_RSS_MB` (default 2048). `start` refuses to start while
  MemAvailable is under `LOCALNET_MIN_AVAIL_MB` (default 3072). `scripts/capped.sh` does the same for one
  command (`TTL`, `MAX_RSS_MB`). Measured RSS: node about 250 MB, indexer about 70 MB, proof server about 215 MB.
- On `undeployed` the CLI uses the genesis wallet seed `00..01` (the same one testkit-js uses; override it with `NP_SEED`).
  It also uses example-bboard's large `additionalFeeOverhead` for this network.
- The community `midnight-wallet-cli` (`midnight localnet up`) runs docker compose underneath, so it can't run on this box.

Two fixes were needed for this to work:
1. `@midnight-ntwrk/onchain-runtime-v3` is pinned to 3.0.0 via `overrides` and deduped to one copy. Before that,
   `compact-runtime` loaded 3.1.2 and `midnight-js-protocol` loaded 3.0.0, and the first circuit call after deploy
   failed with `expected instance of StateValue`.
2. After the wallet submits its first tx, its dust-event subscription sometimes stalls silently. The next tx then
   gets balanced against a stale dust tree, and the node rejects it with `InvalidDustSpendProof` (RPC custom error 170).
   Now `submitTx` waits until the dust wallet has applied the new event (`NP_DUST_WAIT_MS`, default 20 s). If it
   hasn't by then, the wallet is reopened from its serialized state, which resubscribes and catches up. In the
   passing run this happened once, after deploy. `NP_DEBUG_DUST=1` logs every dust progress update.

Sample run (2026-10-11 15:49 to 15:52 UTC+8, about 3.5 min; full log in `logs/localnet-e2e.log`, which is gitignored):

```
INFO: synced: NIGHT=250000000000000 DUST=1250000000000000000000000
WARN: dust wallet did not observe tx 00889c6c...f9a261 in time; re-opening wallet from saved state to resync
INFO: wallet re-opened; dust events applied up to 140
INFO: deployed NightPoll at bb379c046340b8f3499f887e9c98c6cc4e23c0994e033c334aac728d9526c5e6
INFO: carol commitment (sent to admin off-chain): cfcb63228b24168af4779b8ec4cb3da53c289b0b24ae6c19b2243d8c02b31a16
INFO: tally while voting is open:
RESULT {"phase":"VOTING","members":"3","totalVotes":"3","nullifiers":"3","tally":{"0":"1","1":"0","2":"2"}, ...}
RESULT {"network":"undeployed","contractAddress":"bb379c04...26c5e6","txs":{
  "deploy":           "00889c6c45b68617ccd0972515984df70d1a623032bf33f0f158f5d315f4f9a261",
  "register:alice":   "003fbc186d65d287dd59780f99bfad87c54d737bed416580fd939665ab4a38beab",
  "register:bob":     "0083d4fc2c9bdc04a9c0c56e822b004733cc5e819c07583d6505ab39504f7a283a",
  "addMember:carol":  "00e1875a83e863e760f9d77c047a2df21f9e442caa2e5cc1e678a5705f0552d8e2",
  "openVoting":       "00f4bb2fd99a50e178d9baee5fe4952c7e6ac3ceb50b5194c01cb7b2423758a64d",
  "vote:alice":       "00ff9e731d892566b53355240d9b80e173c66efa819e979b78f3a0085326707408",
  "vote:bob":         "0070cf9d4eb92cd590e0382ec767f6b312f126bf17de9ee4bec43bf8dcf9e85d20",
  "vote:carol":       "0091b129b78e3d4801dcc4b9fcd892bdda0eb0b477ff073841f66c7cae0ae8bcd2",
  "closePoll":        "006cb0bce628c7ba438d74a6345c30b00fb43b86964725a729165d1f515e408aa6"},
  "doubleVote":"rejected: ... failed assert: NightPoll: already voted"}
RESULT {"question":"NightPoll demo: best day for the community call?","phase":"CLOSED","members":"3",
        "totalVotes":"3","nullifiers":"3","tally":{"0":"1","1":"0","2":"2"}}
```

The e2e covers deploy, self-registration (alice, bob) and admin-curated `addMember` (carol's commitment is
computed locally and handed to the admin). It then opens voting, casts three anonymous votes (0, 2, 2), shows that
alice's second vote is rejected by the nullifier check, closes the poll and prints the tally. Each step also works as
a separate command with `--network undeployed`. (This older sample run used the earlier output format.) For example, a standalone `register --as alice` was
verified on block 38.

</details>

## License and attribution

Apache License 2.0 (see [LICENSE](LICENSE)). The wallet and provider wiring in `cli/src/wallet.ts` is adapted from
[midnightntwrk/example-bboard](https://github.com/midnightntwrk/example-bboard) (Apache-2.0). Built with Compact,
midnight-js, the Midnight wallet SDK and the official Midnight node, indexer and proof server.
