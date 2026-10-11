import { describe, it, expect, beforeEach } from "vitest";
import { NightPollSimulator, type PollConfig } from "./nightpoll-simulator.js";
import { randomBytes, hex } from "./utils.js";
import { Phase, pureCircuits } from "../managed/nightpoll/contract/index.js";
import { witnesses } from "../witnesses.js";

const cfg = (over: Partial<PollConfig> = {}): PollConfig => ({
  pollId: randomBytes(32),
  question: "Which day for the next community call?",
  options: 3n,
  openRegistration: true,
  ...over,
});

describe("NightPoll: setup", () => {
  it("initializes ledger from constructor args", () => {
    const adminSk = randomBytes(32);
    const c = cfg();
    const sim = new NightPollSimulator(adminSk, c);
    const l = sim.getLedger();
    expect(l.phase).toEqual(Phase.REGISTRATION);
    expect(l.question).toEqual(c.question);
    expect(l.optionCount).toEqual(3n);
    expect(l.selfRegistration).toEqual(true);
    expect(l.pollId).toEqual(c.pollId);
    expect(l.admin).toEqual(pureCircuits.adminKey(c.pollId, adminSk));
    expect(l.memberCount).toEqual(0n);
    expect(l.totalVotes).toEqual(0n);
    expect(l.nullifiers.isEmpty()).toBe(true);
  });

  it("is deterministic for the same inputs", () => {
    const sk = randomBytes(32);
    const c = cfg();
    const snap = (s: NightPollSimulator) => {
      const l = s.getLedger();
      return [l.pollId, l.question, l.optionCount, l.admin, l.phase, l.members.root(), l.memberCount, l.totalVotes];
    };
    expect(snap(new NightPollSimulator(sk, c))).toEqual(snap(new NightPollSimulator(sk, c)));
  });

  it("rejects polls with fewer than 2 options", () => {
    expect(() => new NightPollSimulator(randomBytes(32), cfg({ options: 1n }))).toThrow(/at least 2 options/);
  });
});

describe("NightPoll: registration", () => {
  let adminSk: Uint8Array;
  beforeEach(() => {
    adminSk = randomBytes(32);
  });

  it("self-registration publishes only a commitment", () => {
    const sim = new NightPollSimulator(adminSk, cfg());
    const alice = randomBytes(32);
    const l = sim.as(alice).register();
    expect(l.memberCount).toEqual(1n);
    expect(l.commitments.member(sim.commitmentOf(alice))).toBe(true);
    expect(l.members.findPathForLeaf(sim.commitmentOf(alice))).toBeDefined();
    // commitment and nullifier are distinct values (domain separation)
    expect(hex(sim.commitmentOf(alice))).not.toEqual(hex(sim.nullifierOf(alice)));
    expect(hex(sim.commitmentOf(alice))).not.toEqual(hex(alice));
  });

  it("rejects duplicate registration", () => {
    const sim = new NightPollSimulator(adminSk, cfg());
    const alice = randomBytes(32);
    sim.as(alice).register();
    expect(() => sim.as(alice).register()).toThrow(/already registered/);
  });

  it("rejects self-registration when disabled", () => {
    const sim = new NightPollSimulator(adminSk, cfg({ openRegistration: false }));
    expect(() => sim.as(randomBytes(32)).register()).toThrow(/self-registration disabled/);
  });

  it("admin can add a member by commitment; others cannot", () => {
    const sim = new NightPollSimulator(adminSk, cfg({ openRegistration: false }));
    const bob = randomBytes(32);
    const mallory = randomBytes(32);
    expect(() => sim.as(mallory).addMember(sim.commitmentOf(mallory))).toThrow(/not the admin/);
    const l = sim.as(adminSk).addMember(sim.commitmentOf(bob));
    expect(l.memberCount).toEqual(1n);
    expect(() => sim.as(adminSk).addMember(sim.commitmentOf(bob))).toThrow(/already registered/);
  });

  it("closes registration once voting opens", () => {
    const sim = new NightPollSimulator(adminSk, cfg());
    sim.as(randomBytes(32)).register();
    sim.as(adminSk).openVoting();
    expect(() => sim.as(randomBytes(32)).register()).toThrow(/registration is closed/);
    expect(() => sim.as(adminSk).addMember(randomBytes(32))).toThrow(/registration is closed/);
  });
});

describe("NightPoll: phases", () => {
  it("only admin can open/close, in order", () => {
    const adminSk = randomBytes(32);
    const sim = new NightPollSimulator(adminSk, cfg());
    expect(() => sim.as(adminSk).openVoting()).toThrow(/no members/);
    sim.as(randomBytes(32)).register();
    expect(() => sim.as(randomBytes(32)).openVoting()).toThrow(/not the admin/);
    expect(() => sim.as(adminSk).closePoll()).toThrow(/not in voting/);
    expect(sim.as(adminSk).openVoting().phase).toEqual(Phase.VOTING);
    expect(() => sim.as(adminSk).openVoting()).toThrow(/not in registration/);
    expect(() => sim.as(randomBytes(32)).closePoll()).toThrow(/not the admin/);
    expect(sim.as(adminSk).closePoll().phase).toEqual(Phase.CLOSED);
  });
});

describe("NightPoll: voting", () => {
  let adminSk: Uint8Array;
  let sim: NightPollSimulator;
  let alice: Uint8Array, bob: Uint8Array, carol: Uint8Array;

  beforeEach(() => {
    adminSk = randomBytes(32);
    sim = new NightPollSimulator(adminSk, cfg());
    [alice, bob, carol] = [randomBytes(32), randomBytes(32), randomBytes(32)];
    for (const m of [alice, bob, carol]) sim.as(m).register();
  });

  it("rejects votes before voting opens", () => {
    expect(() => sim.as(alice).vote(0n)).toThrow(/voting is not open/);
  });

  it("counts votes and records nullifiers", () => {
    sim.as(adminSk).openVoting();
    sim.as(alice).vote(0n);
    sim.as(bob).vote(2n);
    const l = sim.as(carol).vote(2n);
    expect(sim.tallyOf(0n)).toEqual(1n);
    expect(sim.tallyOf(1n)).toEqual(0n);
    expect(sim.tallyOf(2n)).toEqual(2n);
    expect(l.totalVotes).toEqual(3n);
    expect(l.nullifiers.size()).toEqual(3n);
    for (const m of [alice, bob, carol]) expect(l.nullifiers.member(sim.nullifierOf(m))).toBe(true);
  });

  it("blocks double voting, even for a different option", () => {
    sim.as(adminSk).openVoting();
    sim.as(alice).vote(1n);
    expect(() => sim.as(alice).vote(1n)).toThrow(/already voted/);
    expect(() => sim.as(alice).vote(0n)).toThrow(/already voted/);
    expect(sim.getLedger().totalVotes).toEqual(1n);
    expect(sim.tallyOf(0n)).toEqual(0n);
  });

  it("rejects out-of-range options", () => {
    sim.as(adminSk).openVoting();
    expect(() => sim.as(alice).vote(3n)).toThrow(/invalid option/);
    expect(() => sim.as(alice).vote(255n)).toThrow(/invalid option/);
  });

  it("honest witness refuses a non-member", () => {
    sim.as(adminSk).openVoting();
    expect(() => sim.as(randomBytes(32)).vote(0n)).toThrow(/not registered/);
  });

  it("circuit rejects a forged Merkle path from another tree", () => {
    // Mallory registers in a different poll instance with the same pollId,
    // then feeds that tree's path to the real poll.
    const mallory = randomBytes(32);
    const shadow = new NightPollSimulator(randomBytes(32), sim.config);
    shadow.as(mallory).register();
    const forgedPath = shadow.getLedger().members.findPathForLeaf(shadow.commitmentOf(mallory))!;

    sim.as(adminSk).openVoting();
    sim.withWitnesses({ ...witnesses, findMembershipPath: ({ privateState }) => [privateState, forgedPath] });
    expect(() => sim.as(mallory).vote(0n)).toThrow(/not a registered member/);
  });

  it("circuit rejects borrowing another member's path", () => {
    const mallory = randomBytes(32);
    sim.as(adminSk).openVoting();
    sim.withWitnesses({
      ...witnesses,
      findMembershipPath: ({ privateState, ledger }) => [
        privateState,
        ledger.members.findPathForLeaf(sim.commitmentOf(alice))!,
      ],
    });
    expect(() => sim.as(mallory).vote(0n)).toThrow(/path does not match member/);
  });

  it("rejects votes after the poll closes", () => {
    sim.as(adminSk).openVoting();
    sim.as(alice).vote(0n);
    sim.as(adminSk).closePoll();
    expect(() => sim.as(bob).vote(0n)).toThrow(/voting is not open/);
    expect(sim.getLedger().totalVotes).toEqual(1n);
  });

  it("ledger never contains secret keys", () => {
    sim.as(adminSk).openVoting();
    sim.as(alice).vote(1n);
    const l = sim.getLedger();
    const pub = [...l.commitments].concat([...l.nullifiers], [l.admin]).map(hex);
    for (const sk of [alice, bob, carol, adminSk]) expect(pub).not.toContain(hex(sk));
  });
});

describe("NightPoll: unlinkability helpers", () => {
  it("same key gives different commitments/nullifiers in different polls", () => {
    const sk = randomBytes(32);
    const [p1, p2] = [randomBytes(32), randomBytes(32)];
    expect(hex(pureCircuits.memberCommitment(p1, sk))).not.toEqual(hex(pureCircuits.memberCommitment(p2, sk)));
    expect(hex(pureCircuits.voteNullifier(p1, sk))).not.toEqual(hex(pureCircuits.voteNullifier(p2, sk)));
  });
});
