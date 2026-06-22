import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Distributor } from "../target/types/distributor";
import { PublicKey, Keypair } from "@solana/web3.js";
import { assert } from "chai";
import { readFileSync } from "fs";

describe("integration: backend settlement -> on-chain publish+claim", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Distributor as Program<Distributor>;
  const admin = provider.wallet;

  const configPda = () => PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId)[0];
  const vaultPda = () => PublicKey.findProgramAddressSync([Buffer.from("vault")], program.programId)[0];
  const periodPda = (id: number) => PublicKey.findProgramAddressSync(
    [Buffer.from("period"), new anchor.BN(id).toArrayLike(Buffer, "le", 8)], program.programId)[0];

  it("publishes the backend root and pays every winner the backend amount", async () => {
    const fx = JSON.parse(readFileSync(__dirname + "/settlement.fixture.json", "utf8"));
    const oracle = Keypair.generate();
    await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(oracle.publicKey, 2e9));

    // init config+vault if this is a fresh validator; ignore "already in use"
    try { await program.methods.initialize(oracle.publicKey).accounts({ admin: admin.publicKey }).rpc(); }
    catch { await program.methods.setOracle(oracle.publicKey).accounts({ admin: admin.publicKey }).rpc(); }
    try { await program.methods.initVault().accounts({ admin: admin.publicKey }).rpc(); } catch {}

    await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(vaultPda(), 1e9));

    const root = [...Buffer.from(fx.rootHex, "hex")];
    await program.methods.publishPeriod(new anchor.BN(fx.periodId), root, new anchor.BN(fx.total))
      .accounts({ oracle: oracle.publicKey }).signers([oracle]).rpc();

    const vaultBefore = await provider.connection.getBalance(vaultPda());
    for (const a of fx.awards) {
      const kp = Keypair.fromSecretKey(Uint8Array.from(a.secretKey));
      assert.equal(kp.publicKey.toBase58(), a.wallet, "fixture keypair matches award wallet");
      await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(kp.publicKey, 1e7)); // rent
      const proof = a.proofHex.map((h: string) => [...Buffer.from(h, "hex")]);
      await program.methods.claim(new anchor.BN(fx.periodId), new anchor.BN(a.index), new anchor.BN(a.amount), proof)
        .accounts({ claimant: kp.publicKey }).signers([kp]).rpc();
    }
    const vaultAfter = await provider.connection.getBalance(vaultPda());
    assert.equal(vaultBefore - vaultAfter, Number(fx.total), "vault decreased by exactly the published total");

    const p = await program.account.period.fetch(periodPda(fx.periodId));
    assert.equal(p.claimedAmount.toString(), fx.total);
  });
});
