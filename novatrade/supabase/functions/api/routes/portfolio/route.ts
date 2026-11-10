import { route } from "../../../_shared/server/http.ts";
import { requireUser, serviceDb } from "../../../_shared/server/auth.ts";
import { loadSettings, paperAccountState, PAPER_START_CASH } from "../../../_shared/server/account.ts";
import { connectorFor } from "../../../_shared/server/connections.ts";


export const GET = route(async () => {
  const s = await requireUser();
  const settings = await loadSettings(s.userId);
  const paper = await paperAccountState(s.userId, settings.emergencyStop);
  const { data: conns } = await serviceDb().from("nova_broker_connections").select("id,provider,label,environment,status").eq("user_id", s.userId).eq("status", "connected");
  const brokers = await Promise.all((conns ?? []).map(async (c) => {
    try {
      const { connector } = await connectorFor(s.userId, c.id as string);
      const [account, positions] = await Promise.all([connector.getAccount(), connector.getPositions()]);
      return { ...c, ok: true as const, account, positions };
    } catch (e) {
      return { ...c, ok: false as const, error: e instanceof Error ? e.message : "unavailable" };
    }
  }));
  return {
    mode: settings.executionMode,
    paper: {
      startCash: PAPER_START_CASH, cash: paper.loaded.account.cash, equity: paper.state.equity, positions: paper.loaded.account.positions,
      unpriced: paper.unpriced, note: "Simulated account. Fills are modelled with fees and slippage; they are not real trades.",
    },
    brokers,
  };
});
