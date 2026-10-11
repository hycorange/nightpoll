import {
  type CircuitContext,
  QueryContext,
  sampleContractAddress,
  createConstructorContext,
  CostModel,
} from "@midnight-ntwrk/compact-runtime";
import {
  Contract,
  type Ledger,
  type Witnesses,
  ledger,
  pureCircuits,
} from "../managed/nightpoll/contract/index.js";
import { type NightPollPrivateState, witnesses as defaultWitnesses } from "../witnesses.js";

export type PollConfig = {
  pollId: Uint8Array;
  question: string;
  options: bigint;
  openRegistration: boolean;
};

/** In-memory test bed: runs circuits locally against a simulated ledger (no proofs, no network). */
export class NightPollSimulator {
  contract: Contract<NightPollPrivateState>;
  circuitContext: CircuitContext<NightPollPrivateState>;

  constructor(adminSecretKey: Uint8Array, readonly config: PollConfig) {
    this.contract = new Contract<NightPollPrivateState>(defaultWitnesses);
    const { currentPrivateState, currentContractState, currentZswapLocalState } =
      this.contract.initialState(
        createConstructorContext({ secretKey: adminSecretKey }, "0".repeat(64)),
        config.pollId,
        config.question,
        config.options,
        config.openRegistration,
      );
    this.circuitContext = {
      currentPrivateState,
      currentZswapLocalState,
      costModel: CostModel.initialCostModel(),
      currentQueryContext: new QueryContext(currentContractState.data, sampleContractAddress()),
    };
  }

  /** Act as a different user (different local secret key). */
  as(secretKey: Uint8Array): this {
    this.circuitContext.currentPrivateState = { secretKey };
    return this;
  }

  /** Swap in custom (e.g. malicious) witness implementations. */
  withWitnesses(w: Witnesses<NightPollPrivateState>): this {
    this.contract = new Contract<NightPollPrivateState>(w);
    return this;
  }

  getLedger(): Ledger {
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  private run(f: (c: Contract<NightPollPrivateState>) => { context: CircuitContext<NightPollPrivateState> }): Ledger {
    this.circuitContext = f(this.contract).context;
    return this.getLedger();
  }

  register(): Ledger {
    return this.run((c) => c.impureCircuits.register(this.circuitContext));
  }
  addMember(commitment: Uint8Array): Ledger {
    return this.run((c) => c.impureCircuits.addMember(this.circuitContext, commitment));
  }
  openVoting(): Ledger {
    return this.run((c) => c.impureCircuits.openVoting(this.circuitContext));
  }
  closePoll(): Ledger {
    return this.run((c) => c.impureCircuits.closePoll(this.circuitContext));
  }
  vote(choice: bigint): Ledger {
    return this.run((c) => c.impureCircuits.vote(this.circuitContext, choice));
  }

  commitmentOf(sk: Uint8Array): Uint8Array {
    return pureCircuits.memberCommitment(this.config.pollId, sk);
  }
  nullifierOf(sk: Uint8Array): Uint8Array {
    return pureCircuits.voteNullifier(this.config.pollId, sk);
  }
  tallyOf(choice: bigint): bigint {
    const t = this.getLedger().tally;
    return t.member(choice) ? t.lookup(choice).read() : 0n;
  }
}
