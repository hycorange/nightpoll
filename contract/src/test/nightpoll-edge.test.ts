// Edge-case and adversarial tests added after the Wave 2 deployment.
// They run against the CURRENT contract (src/nightpoll.compact, unchanged) on the Compact simulator.
// Tests marked "LIMITATION" pass by design: they pin down behaviour documented in docs/THREAT-MODEL.md.
import { describe, it, expect, beforeEach } from "vitest";
import { NightPollSimulator, type PollConfig } from "./nightpoll-simulator.js";
import { randomBytes, hex } from "./utils.js";
import { Phase } from "../managed/nightpoll/contract/index.js";

const cfg = (over: Partial<PollConfig> = {}): PollConfig => ({
  pollId: randomBytes(32),
  question: "Edge cases",
  options: 3n,
  openRegistration: true,
  ...over,
});

/** Snapshot of everything a failed circuit call must leave untouched. */
const snap = (s: NightPollSimulator) => {
  const l = s.getLedger();
  return {
    phase: l.phase,
    root: JSON.stringify(l.members.root(), (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
    members: l.memberCount,
    votes: l.totalVotes,
    nullifiers: [...l.nullifiers].map(hex).sort(),
    commitments: [...l.commitments].map(hex).sort(),
    tally: [0n, 1n, 2n].map((k) => s.tallyOf(k)),
  };
};

describe("NightPoll edge: phase machine", () => {
  let adminSk: Uint8Array;
  let sim: NightPollSimulator;
  beforeEach(() => {
    adminSk = randomBytes(32);
    sim = new NightPollSimulator(adminSk, cfg());
    sim.as(randomBytes(32)).register();
  });

  it("closing twice is rejected and the poll stays CLOSED", () => {
    sim.as(adminSk).openVoting();
    sim.as(adminSk).closePoll();
    expect(() => sim.as(adminSk).closePoll()).toThrow(/not in voting/);
    expect(sim.getLedger().phase).toEqual(Phase.CLOSED);
  });

  it("a closed poll cannot be reopened", () => {
    sim.as(adminSk).openVoting();
    sim.as(adminSk).closePoll();
    expect(() => sim.as(adminSk).openVoting()).toThrow(/not in registration/);
    expect(sim.getLedger().phase).toEqual(Phase.CLOSED);
  });

  it("closing straight from REGISTRATION is rejected", () => {
    expect(() => sim.as(adminSk).closePoll()).toThrow(/not in voting/);
    expect(sim.getLedger().phase).toEqual(Phase.REGISTRATION);
  });

  it("no registration of any kind after the poll is closed", () => {
    sim.as(adminSk).openVoting();
    sim.as(adminSk).closePoll();
    expect(() => sim.as(randomBytes(32)).register()).toThrow(/registration is closed/);
    expect(() => sim.as(adminSk).addMember(randomBytes(32))).toThrow(/registration is closed/);
  });

  it("phase is checked before membership: a non-member voting early gets 'voting is not open'", () => {
    expect(() => sim.as(randomBytes(32)).vote(0n)).toThrow(/voting is not open/);
  });
});

describe("NightPoll edge: admin-only actions", () => {
  it("a registered member is not an admin (open, close, addMember all rejected)", () => {
    const adminSk = randomBytes(32);
    const member = randomBytes(32);
    const sim = new NightPollSimulator(adminSk, cfg());
    sim.as(member).register();
    expect(() => sim.as(member).addMember(randomBytes(32))).toThrow(/not the admin/);
    expect(() => sim.as(member).openVoting()).toThrow(/not the admin/);
    sim.as(adminSk).openVoting();
    expect(() => sim.as(member).closePoll()).toThrow(/not the admin/);
    expect(sim.getLedger().phase).toEqual(Phase.VOTING);
  });

  it("the admin key of one poll does not administer another poll", () => {
    const adminA = randomBytes(32);
    const adminB = randomBytes(32);
    const simB = new NightPollSimulator(adminB, cfg());
    simB.as(randomBytes(32)).register();
    expect(() => simB.as(adminA).openVoting()).toThrow(/not the admin/);
  });

  it("the admin is not a member unless registered", () => {
    const adminSk = randomBytes(32);
    const sim = new NightPollSimulator(adminSk, cfg());
    sim.as(randomBytes(32)).register();
    sim.as(adminSk).openVoting();
    expect(() => sim.as(adminSk).vote(0n)).toThrow(/not registered/);
  });

  it("the admin may also register as a member and then votes exactly once", () => {
    const adminSk = randomBytes(32);
    const sim = new NightPollSimulator(adminSk, cfg());
    sim.as(adminSk).register();
    sim.as(adminSk).openVoting();
    sim.as(adminSk).vote(1n);
    expect(() => sim.as(adminSk).vote(2n)).toThrow(/already voted/);
    expect(sim.tallyOf(1n)).toEqual(1n);
  });
});

describe("NightPoll edge: option bounds", () => {
  it("2-option poll: option 1 is valid, option 2 is rejected", () => {
    const adminSk = randomBytes(32);
    const [a, b] = [randomBytes(32), randomBytes(32)];
    const sim = new NightPollSimulator(adminSk, cfg({ options: 2n }));
    sim.as(a).register();
    sim.as(b).register();
    sim.as(adminSk).openVoting();
    expect(() => sim.as(a).vote(2n)).toThrow(/invalid option/);
    sim.as(a).vote(1n);
    expect(sim.tallyOf(1n)).toEqual(1n);
  });

  it("255-option poll: option 254 is valid, option 255 is rejected", () => {
    const adminSk = randomBytes(32);
    const a = randomBytes(32);
    const sim = new NightPollSimulator(adminSk, cfg({ options: 255n }));
    sim.as(a).register();
    sim.as(adminSk).openVoting();
    expect(() => sim.as(a).vote(255n)).toThrow(/invalid option/);
    sim.as(a).vote(254n);
    expect(sim.tallyOf(254n)).toEqual(1n);
  });

  it("an invalid-option attempt does not burn the member's vote", () => {
    const adminSk = randomBytes(32);
    const a = randomBytes(32);
    const sim = new NightPollSimulator(adminSk, cfg());
    sim.as(a).register();
    sim.as(adminSk).openVoting();
    expect(() => sim.as(a).vote(7n)).toThrow(/invalid option/);
    sim.as(a).vote(0n);
    expect(sim.getLedger().totalVotes).toEqual(1n);
  });
});

describe("NightPoll edge: failed calls leave the ledger unchanged", () => {
  it("rejected votes, registrations and admin calls do not modify public state", () => {
    const adminSk = randomBytes(32);
    const [a, b] = [randomBytes(32), randomBytes(32)];
    const sim = new NightPollSimulator(adminSk, cfg());
    sim.as(a).register();
    sim.as(b).register();
    sim.as(adminSk).openVoting();
    sim.as(a).vote(2n);
    const before = snap(sim);
    expect(() => sim.as(a).vote(1n)).toThrow(/already voted/);
    expect(() => sim.as(b).vote(9n)).toThrow(/invalid option/);
    expect(() => sim.as(randomBytes(32)).vote(0n)).toThrow(/not registered/);
    expect(() => sim.as(randomBytes(32)).register()).toThrow(/registration is closed/);
    expect(() => sim.as(b).closePoll()).toThrow(/not the admin/);
    expect(snap(sim)).toEqual(before);
  });
});

describe("NightPoll edge: tally consistency", () => {
  it("sum of the per-option tally equals totalVotes equals number of nullifiers", () => {
    const adminSk = randomBytes(32);
    const sim = new NightPollSimulator(adminSk, cfg({ options: 4n }));
    const voters = Array.from({ length: 6 }, () => randomBytes(32));
    for (const v of voters) sim.as(v).register();
    sim.as(adminSk).openVoting();
    const choices = [0n, 3n, 3n, 1n, 3n, 0n];
    voters.forEach((v, i) => sim.as(v).vote(choices[i]));
    const l = sim.getLedger();
    const sum = [0n, 1n, 2n, 3n].reduce((acc, k) => acc + sim.tallyOf(k), 0n);
    expect(sum).toEqual(6n);
    expect(l.totalVotes).toEqual(6n);
    expect(l.nullifiers.size()).toEqual(6n);
    expect([0n, 1n, 2n, 3n].map((k) => sim.tallyOf(k))).toEqual([2n, 1n, 0n, 3n]);
  });

  it("a member's nullifier is independent across polls: the same key votes once in each", () => {
    const sk = randomBytes(32);
    const polls = [0, 1].map(() => {
      const adminSk = randomBytes(32);
      const s = new NightPollSimulator(adminSk, cfg());
      s.as(sk).register();
      s.as(adminSk).openVoting();
      return s;
    });
    for (const s of polls) s.as(sk).vote(0n);
    expect(hex(polls[0].nullifierOf(sk))).not.toEqual(hex(polls[1].nullifierOf(sk)));
    for (const s of polls) expect(() => s.as(sk).vote(1n)).toThrow(/already voted/);
  });

  it("a commitment added by the admin cannot be self-registered again (and vice versa)", () => {
    const adminSk = randomBytes(32);
    const a = randomBytes(32);
    const b = randomBytes(32);
    const sim = new NightPollSimulator(adminSk, cfg());
    sim.as(adminSk).addMember(sim.commitmentOf(a));
    expect(() => sim.as(a).register()).toThrow(/already registered/);
    sim.as(b).register();
    expect(() => sim.as(adminSk).addMember(sim.commitmentOf(b))).toThrow(/already registered/);
    expect(sim.getLedger().memberCount).toEqual(2n);
  });
});

describe("NightPoll edge: documented limitations (see docs/THREAT-MODEL.md)", () => {
  it("LIMITATION: with open registration, one person holding several keys gets several votes (no Sybil resistance)", () => {
    const adminSk = randomBytes(32);
    const sim = new NightPollSimulator(adminSk, cfg());
    const [k1, k2] = [randomBytes(32), randomBytes(32)]; // both held by the same person
    sim.as(k1).register();
    sim.as(k2).register();
    sim.as(adminSk).openVoting();
    sim.as(k1).vote(0n);
    sim.as(k2).vote(0n);
    expect(sim.tallyOf(0n)).toEqual(2n);
  });

  it("LIMITATION: in a curated poll the admin can add commitments for keys it controls and vote with them", () => {
    const adminSk = randomBytes(32);
    const sim = new NightPollSimulator(adminSk, cfg({ openRegistration: false }));
    const ghosts = [randomBytes(32), randomBytes(32)];
    for (const g of ghosts) sim.as(adminSk).addMember(sim.commitmentOf(g));
    sim.as(adminSk).openVoting();
    for (const g of ghosts) sim.as(g).vote(2n);
    expect(sim.tallyOf(2n)).toEqual(2n);
  });

  it("LIMITATION: addMember accepts any 32 bytes, so the admin can inflate memberCount with commitments nobody can open", () => {
    const adminSk = randomBytes(32);
    const sim = new NightPollSimulator(adminSk, cfg({ openRegistration: false }));
    sim.as(adminSk).addMember(randomBytes(32));
    expect(sim.getLedger().memberCount).toEqual(1n);
    sim.as(adminSk).openVoting(); // the "no members" check is satisfied by an unopenable commitment
    expect(sim.getLedger().phase).toEqual(Phase.VOTING);
  });
});
