import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Distributor } from "../target/types/distributor";
import { PublicKey, Keypair } from "@solana/web3.js";
import { assert } from "chai";
import { buildTree, Award } from "./merkle";

describe("distributor", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Distributor as Program<Distributor>;
  const admin = provider.wallet;

  const configPda = () =>
    PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId)[0];
  const vaultPda = () =>
    PublicKey.findProgramAddressSync([Buffer.from("vault")], program.programId)[0];
  const periodPda = (id: number) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("period"), new anchor.BN(id).toArrayLike(Buffer, "le", 8)],
      program.programId
    )[0];

  it("initializes config with admin and oracle", async () => {
    const oracle = Keypair.generate();
    await program.methods
      .initialize(oracle.publicKey)
      .accounts({ admin: admin.publicKey })
      .rpc();
    const cfg = await program.account.config.fetch(configPda());
    assert.ok(cfg.admin.equals(admin.publicKey));
    assert.ok(cfg.oracle.equals(oracle.publicKey));
  });

  it("lets admin rotate the oracle and rejects non-admin", async () => {
    const newOracle = Keypair.generate();
    await program.methods.setOracle(newOracle.publicKey).accounts({ admin: admin.publicKey }).rpc();
    let cfg = await program.account.config.fetch(configPda());
    assert.ok(cfg.oracle.equals(newOracle.publicKey));

    const stranger = Keypair.generate();
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(stranger.publicKey, 1e9)
    );
    let failed = false;
    try {
      await program.methods.setOracle(Keypair.generate().publicKey)
        .accounts({ admin: stranger.publicKey }).signers([stranger]).rpc();
    } catch { failed = true; }
    assert.isTrue(failed, "non-admin must not rotate oracle");
  });

  it("funds the vault and publishes a period under the solvency cap", async () => {
    // ensure the vault account exists (ignore if a prior test already created it)
    try {
      await program.methods.initVault().accounts({ admin: admin.publicKey }).rpc();
    } catch (_) { /* already initialized */ }

    // fund the vault PDA with 2 SOL
    const tx = await provider.connection.requestAirdrop(vaultPda(), 2e9);
    await provider.connection.confirmTransaction(tx);

    // current oracle from prior test is `newOracle`; re-set a known oracle we control
    const oracle = Keypair.generate();
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(oracle.publicKey, 1e9)
    );
    await program.methods.setOracle(oracle.publicKey).accounts({ admin: admin.publicKey }).rpc();

    const root = Buffer.alloc(32, 1);
    // over-cap publish must fail (3 SOL > 2 SOL vault)
    let failed = false;
    try {
      await program.methods.publishPeriod(new anchor.BN(100), [...root], new anchor.BN(3e9))
        .accounts({ oracle: oracle.publicKey }).signers([oracle]).rpc();
    } catch { failed = true; }
    assert.isTrue(failed, "over-cap publish must fail");

    // within-cap publish by oracle succeeds
    await program.methods.publishPeriod(new anchor.BN(100), [...root], new anchor.BN(1e9))
      .accounts({ oracle: oracle.publicKey }).signers([oracle]).rpc();
    const p = await program.account.period.fetch(periodPda(100));
    assert.equal(p.totalAmount.toNumber(), 1e9);
    assert.equal(p.claimedAmount.toNumber(), 0);

    // non-oracle publish must fail
    const stranger = Keypair.generate();
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(stranger.publicKey, 1e9)
    );
    let failed2 = false;
    try {
      await program.methods.publishPeriod(new anchor.BN(101), [...root], new anchor.BN(1e8))
        .accounts({ oracle: stranger.publicKey }).signers([stranger]).rpc();
    } catch { failed2 = true; }
    assert.isTrue(failed2, "non-oracle publish must fail");
  });

  const claimStatusPda = (id: number, who: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("claim"), new anchor.BN(id).toArrayLike(Buffer, "le", 8), who.toBuffer()],
      program.programId
    )[0];

  it("pays a valid claim, rejects bad proof, blocks double-claim", async () => {
    const oracle = Keypair.generate();
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(oracle.publicKey, 2e9));
    await program.methods.setOracle(oracle.publicKey).accounts({ admin: admin.publicKey }).rpc();

    const winner = Keypair.generate();
    const other = Keypair.generate();
    const awards: Award[] = [
      { index: 0, claimant: winner.publicKey, amount: new anchor.BN(5e8) },
      { index: 1, claimant: other.publicKey, amount: new anchor.BN(3e8) },
    ];
    const { root, proofs } = buildTree(awards);

    const PERIOD = 200;
    await program.methods
      .publishPeriod(new anchor.BN(PERIOD), [...root], new anchor.BN(8e8))
      .accounts({ oracle: oracle.publicKey }).signers([oracle]).rpc();

    // winner needs lamports to pay rent for its claim_status PDA (payer = claimant)
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(winner.publicKey, 1e7));
    // measure the payout via the vault's balance decrease (exactly the award,
    // independent of the rent the claimant pays for claim_status)
    const vaultBefore = await provider.connection.getBalance(vaultPda());
    const before = await provider.connection.getBalance(winner.publicKey);
    await program.methods
      .claim(new anchor.BN(PERIOD), new anchor.BN(0), new anchor.BN(5e8),
        proofs[0].map((b) => [...b]))
      .accounts({ claimant: winner.publicKey }).signers([winner]).rpc();
    const after = await provider.connection.getBalance(winner.publicKey);
    const vaultAfter = await provider.connection.getBalance(vaultPda());
    assert.equal(vaultBefore - vaultAfter, 5e8);
    assert.isAbove(after, before); // winner netted the payout minus claim_status rent

    // double-claim must fail
    let dbl = false;
    try {
      await program.methods.claim(new anchor.BN(PERIOD), new anchor.BN(0), new anchor.BN(5e8),
        proofs[0].map((b) => [...b]))
        .accounts({ claimant: winner.publicKey }).signers([winner]).rpc();
    } catch { dbl = true; }
    assert.isTrue(dbl, "double claim must fail");

    // wrong amount / bad proof must fail
    let bad = false;
    try {
      await program.methods.claim(new anchor.BN(PERIOD), new anchor.BN(1), new anchor.BN(9e8),
        proofs[1].map((b) => [...b]))
        .accounts({ claimant: other.publicKey }).signers([other]).rpc();
    } catch { bad = true; }
    assert.isTrue(bad, "claim with wrong amount must fail");
  });

  it("end-to-end: fund -> publish hour -> top-10 each claim once", async () => {
    const oracle = Keypair.generate();
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(oracle.publicKey, 2e9));
    await program.methods.setOracle(oracle.publicKey).accounts({ admin: admin.publicKey }).rpc();
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(vaultPda(), 2e9));

    const winners = Array.from({ length: 10 }, () => Keypair.generate());
    const per = new anchor.BN(1e8); // 0.1 SOL each => 1 SOL total
    const awards: Award[] = winners.map((w, i) => ({ index: i, claimant: w.publicKey, amount: per }));
    const { root, proofs } = buildTree(awards);

    const HOUR = 481968; // example UTC hour bucket
    await program.methods.publishPeriod(new anchor.BN(HOUR), [...root], new anchor.BN(1e9))
      .accounts({ oracle: oracle.publicKey }).signers([oracle]).rpc();

    for (let i = 0; i < winners.length; i++) {
      const w = winners[i];
      await provider.connection.confirmTransaction(
        await provider.connection.requestAirdrop(w.publicKey, 1e7)); // rent for claim_status
      const before = await provider.connection.getBalance(w.publicKey);
      await program.methods.claim(new anchor.BN(HOUR), new anchor.BN(i), per, proofs[i].map((b) => [...b]))
        .accounts({ claimant: w.publicKey }).signers([w]).rpc();
      const after = await provider.connection.getBalance(w.publicKey);
      assert.isAbove(after, before); // received payout (net of claim_status rent)
    }
    const p = await program.account.period.fetch(periodPda(HOUR));
    assert.equal(p.claimedAmount.toNumber(), 1e9);
  });
});
