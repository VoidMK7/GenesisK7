import { body, HttpError, rateLimit, route, v } from "../../../../../_shared/server/http.ts";
import { requireUser } from "../../../../../_shared/server/auth.ts";
import { exportKey, reclaimRent, setWithdrawAddress, syncDeposits, withdrawSol } from "../../../../../_shared/server/live.ts";

/** Wallet actions: save/change the withdrawal address, withdraw SOL, reclaim rent from empty token accounts, refresh deposits, export the key. */
export const POST = route(async (req: Request) => {
  const s = await requireUser(); const b = await body(req);
  const action = v.oneOf(b, "action", ["set_withdraw_address", "withdraw", "reclaim", "sync", "export"] as const);
  rateLimit(`live-act:${s.userId}`, 12, 60_000);
  if (action === "set_withdraw_address") return setWithdrawAddress(s.userId, v.str(b, "address", { max: 60 }));
  if (action === "sync") return syncDeposits(s.userId);
  if (action === "reclaim") return reclaimRent(s.userId);
  if (action === "withdraw") {
    if (b.confirm !== true) throw new HttpError(400, "Confirm the withdrawal first.");
    const amt = b.max === true ? ("max" as const) : v.num(b, "amountSol", { min: 0.000001, max: 100000 })!;
    return withdrawSol(s.userId, amt);
  }
  rateLimit(`live-export:${s.userId}`, 3, 600_000);
  if (b.confirm !== "EXPORT") throw new HttpError(400, "Type EXPORT to confirm.");
  return { secretKey: await exportKey(s.userId), note: "Anyone with this key controls the wallet. Keep it offline. Import it in Phantom or Solflare as a private key." };
});
