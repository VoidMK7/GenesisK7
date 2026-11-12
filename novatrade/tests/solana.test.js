const test = require("node:test"); const assert = require("node:assert/strict");
const S = require("../.build/core/solana/index.js");
const nacl = require("/opt/npm-tools/node_modules/tweetnacl");

test("base58 round trips and matches known vectors", () => {
  assert.equal(S.b58encode(Buffer.from("Hello World!")), "2NEpo7TZRRrLZSi2U");
  assert.deepEqual([...S.b58decode("2NEpo7TZRRrLZSi2U")], [...Buffer.from("Hello World!")]);
  assert.equal(S.b58encode(new Uint8Array(32)), "11111111111111111111111111111111");
  assert.equal(S.b58decode("11111111111111111111111111111111").length, 32);
  for (let i = 0; i < 50; i++) { const b = crypto.getRandomValues(new Uint8Array(32)); b[0] = i % 3 === 0 ? 0 : b[0]; assert.deepEqual([...S.b58decode(S.b58encode(b))], [...b]); }
  assert.throws(() => S.b58decode("0OIl"), /base58/);
});

test("ed25519: RFC 8032 test vector 1 (public key and signature)", async () => {
  const seed = S.fromHex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60");
  const kp = await S.keypairFromSeed(seed);
  assert.equal(S.toHex(kp.publicKey), "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a");
  const sig = await S.sign(seed, new Uint8Array(0));
  assert.equal(S.toHex(sig), "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b");
  assert.equal(await S.verify(kp.publicKey, new Uint8Array(0), sig), true);
  assert.equal(await S.verify(kp.publicKey, new Uint8Array([1]), sig), false);
});

test("generated keypairs are valid, distinct and exportable in Phantom's format", async () => {
  const a = await S.generateKeypair(), b = await S.generateKeypair();
  assert.notEqual(a.address, b.address); assert.match(a.address, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  const exp = S.b58decode(S.exportSecretKeyBase58(a)); assert.equal(exp.length, 64);
  assert.deepEqual([...exp.slice(0, 32)], [...a.seed]); assert.deepEqual([...exp.slice(32)], [...a.publicKey]);
  const kp = nacl.sign.keyPair.fromSecretKey(exp);                       // an independent implementation accepts the exported key
  assert.deepEqual([...kp.publicKey], [...a.publicKey]);
});

test("compact-u16 vectors", () => {
  for (const [n, bytes] of [[0, [0]], [127, [0x7f]], [128, [0x80, 1]], [255, [0xff, 1]], [16384, [0x80, 0x80, 1]]]) {
    assert.deepEqual(S.compactU16Encode(n), bytes); assert.equal(S.compactU16Decode(Uint8Array.from(bytes), 0)[0], n);
  }
});

test("SOL transfer: exact wire layout, valid signature, readable by an independent verifier", async () => {
  const from = await S.generateKeypair(), to = await S.generateKeypair(); const bh = crypto.getRandomValues(new Uint8Array(32));
  const raw = S.buildSolTransfer(from.publicKey, to.publicKey, 1_500_000n, bh);
  assert.equal(raw.length, 1 + 64 + 3 + 1 + 96 + 32 + 1 + 1 + 1 + 2 + 1 + 12);          // 215 bytes, the standard single-transfer size
  assert.deepEqual([...raw.slice(65, 68)], [1, 0, 1]);
  const data = raw.slice(raw.length - 12); assert.deepEqual([...data.slice(0, 4)], [2, 0, 0, 0]);
  assert.equal(Number(new DataView(data.buffer, data.byteOffset + 4, 8).getBigUint64(0, true)), 1_500_000);
  const signed = await S.signTransaction(raw, from.seed, from.publicKey);
  const p = S.parseTx(signed); assert.equal(p.version, "legacy"); assert.equal(p.numRequiredSignatures, 1);
  assert.equal(nacl.sign.detached.verify(p.message, signed.slice(1, 65), from.publicKey), true);
  await assert.rejects(S.signTransaction(raw, to.seed, to.publicKey), /does not ask/);
  assert.throws(() => S.buildSolTransfer(from.publicKey, to.publicKey, 0n, bh), /above zero/);
});

test("signTransaction fills only our slot of a two-signer v0 transaction (market-maker case)", async () => {
  const me = await S.generateKeypair(), mm = await S.generateKeypair();
  const keys = [me.publicKey, mm.publicKey, new Uint8Array(32).fill(7)];
  const msg = Uint8Array.from([0x80, 2, 0, 1, 3, ...keys.flatMap((k) => [...k]), ...new Uint8Array(32).fill(9), 0, 0]);     // v0, no instructions, no lookups
  const tx = Uint8Array.from([2, ...new Uint8Array(128), ...msg]);
  const out = await S.signTransaction(tx, me.seed, me.publicKey);
  assert.equal(nacl.sign.detached.verify(msg, out.slice(1, 65), me.publicKey), true);
  assert.deepEqual([...out.slice(65, 129)], new Array(64).fill(0));                       // market maker slot untouched
  const out2 = await S.signTransaction(tx, mm.seed, mm.publicKey);
  assert.deepEqual([...out2.slice(1, 65)], new Array(64).fill(0)); assert.equal(nacl.sign.detached.verify(msg, out2.slice(65, 129), mm.publicKey), true);
  assert.throws(() => S.parseTx(Uint8Array.from([1, ...new Uint8Array(64), 0x81, 1, 0, 0, 0])), /Unsupported transaction version/);
});

test("close-account transaction: layout and signer", async () => {
  const me = await S.generateKeypair(); const a1 = await S.generateKeypair(), a2 = await S.generateKeypair();
  const tokenProg = S.b58decode(S.TOKEN_PROGRAM), t22 = S.b58decode(S.TOKEN_2022_PROGRAM); const bh = new Uint8Array(32).fill(5);
  const raw = S.buildCloseAccounts(me.publicKey, [{ address: a1.publicKey, programId: tokenProg }, { address: a2.publicKey, programId: t22 }], bh);
  const p = S.parseTx(raw); assert.equal(p.accountKeys.length, 5); assert.equal(p.numRequiredSignatures, 1);
  assert.deepEqual([...p.message.slice(0, 3)], [1, 0, 2]);                                 // 2 read-only program ids
  const signed = await S.signTransaction(raw, me.seed, me.publicKey);
  assert.equal(nacl.sign.detached.verify(S.parseTx(signed).message, signed.slice(1, 65), me.publicKey), true);
  assert.throws(() => S.buildCloseAccounts(me.publicKey, [], bh), /between 1 and 8/);
});

test("txEffect reads fee, SOL, wrapped SOL and token changes from the transaction's own records", () => {
  const me = "WALLET", mint = "MINT";
  const tx = { meta: { err: null, fee: 5000, preBalances: [1_000_000_000, 5], postBalances: [880_000_000, 5],
      preTokenBalances: [{ accountIndex: 2, mint, owner: me, uiTokenAmount: { amount: "100", decimals: 6 } }], postTokenBalances: [{ accountIndex: 2, mint, owner: me, uiTokenAmount: { amount: "2500100", decimals: 6 } }, { accountIndex: 3, mint: S.WSOL_MINT, owner: me, uiTokenAmount: { amount: "7", decimals: 9 } }] },
    transaction: { message: { accountKeys: [me, "other"] } } };
  const e = S.txEffect(tx, me, mint);
  assert.equal(e.ok, true); assert.equal(e.feeLamports, 5000); assert.equal(e.lamportDelta, -120_000_000); assert.equal(e.tokenDeltaRaw, 2_500_000n); assert.equal(e.decimals, 6); assert.equal(e.wsolDelta, 7);
  assert.equal(S.txEffect({ ...tx, meta: { ...tx.meta, err: { InstructionError: [0, "x"] } } }, me, mint).ok, false);
  assert.throws(() => S.txEffect(tx, "nobody", mint), /not part/);
});

test("amount helpers: USD to lamports, fractions, no dust on full sells", () => {
  assert.equal(S.lamportsFromUsd(3, 150), 20_000_000n);
  assert.equal(S.solFromLamports(2_500_000_000), 2.5);
  assert.equal(S.rawForFraction(1000n, 0.25), 250n); assert.equal(S.rawForFraction(1000n, 1), 1000n); assert.equal(S.rawForFraction(1001n, 0.9995), 1001n);
  assert.throws(() => S.rawForFraction(10n, 0), /fraction/); assert.throws(() => S.rawForFraction(10n, 1.2), /fraction/);
  assert.equal(S.uiFromRaw(2_500_000n, 6), 2.5);
});
