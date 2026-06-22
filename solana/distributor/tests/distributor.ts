import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Distributor } from "../target/types/distributor";
import { PublicKey, Keypair } from "@solana/web3.js";
import { assert } from "chai";

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
});
