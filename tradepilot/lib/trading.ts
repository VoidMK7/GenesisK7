import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt } from "./crypto";
import * as bn from "./binance";
import { fetchKlines, fetchPrice, isSymbol } from "./market";
import { sizePosition } from "./risk";

export type Step = { at: string; msg: string };
export type TradeInput = {
  mode: "paper" | "live"; symbol: string; side: "buy" | "sell"; stop: number; target: number;
  riskPct: number; strategyId?: string | null; connectionId?: string | null; confirm: boolean;
};
type Settings = { max_risk_pct: number; max_open_trades: number; daily_loss_limit_pct: number; paper_balance: number; live_enabled: boolean };
const DEFAULTS: Settings = { max_risk_pct: 1, max_open_trades: 3, daily_loss_limit_pct: 3, paper_balance: 10000, live_enabled: false };

export async function getSettings(sb: SupabaseClient, userId: string): Promise<Settings> {
  const { data } = await sb.from("risk_settings").select("*").eq("user_id", userId).maybeSingle();
  return (data as Settings) ?? DEFAULTS;
}

const symbolQuote = (sym: string) => (sym.match(/(USDT|USDC|FDUSD|BUSD)$/)?.[1] ?? "USDT");
type Creds = bn.Creds;
async function loadCreds(sb: SupabaseClient, userId: string, connectionId: string): Promise<Creds> {
  const { data } = await sb.from("connections").select("*").eq("id", connectionId).eq("user_id", userId).single();
  if (!data) throw new Error("Connection not found");
  return { apiKey: decrypt(data.api_key_enc), apiSecret: decrypt(data.api_secret_enc), testnet: data.testnet };
}

// Opens a trade after running every risk check. Each step is logged and saved on the trade.
export async function openTrade(sb: SupabaseClient, userId: string, input: TradeInput) {
  const steps: Step[] = [];
  const log = (msg: string) => steps.push({ at: new Date().toISOString(), msg });
  const fail = (msg: string) => { throw new Error(msg); };

  if (!input.confirm) fail("Trade must be explicitly confirmed");
  if (!isSymbol(input.symbol)) fail("Invalid symbol");
  const s = await getSettings(sb, userId);
  log(`Risk settings: max ${s.max_risk_pct}% per trade, max ${s.max_open_trades} open, daily loss limit ${s.daily_loss_limit_pct}%`);

  if (input.riskPct > s.max_risk_pct) fail(`Requested risk ${input.riskPct}% exceeds your limit of ${s.max_risk_pct}%`);
  log(`Risk per trade ${input.riskPct}% is within limit`);

  const price = await fetchPrice(input.symbol);
  log(`Live price ${input.symbol}: ${price}`);
  const goodGeometry = input.side === "buy" ? input.stop < price && input.target > price : input.stop > price && input.target < price;
  if (!goodGeometry) fail("Stop/target are on the wrong side of the current price");
  log(`Stop ${input.stop}, target ${input.target} are valid for a ${input.side}`);

  const { count: open } = await sb.from("trades").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("status", "open");
  if ((open ?? 0) >= s.max_open_trades) fail(`You already have ${open} open trades (limit ${s.max_open_trades})`);
  log(`Open trades ${open ?? 0}/${s.max_open_trades}`);

  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
  const { data: today } = await sb.from("trades").select("pnl").eq("user_id", userId).eq("status", "closed").gte("closed_at", dayStart.toISOString());
  const todayPnl = (today || []).reduce((a, t) => a + Number(t.pnl || 0), 0);

  let qty: number, entry = price, exchangeRef: Record<string, unknown> | null = null, connectionId: string | null = null;

  if (input.mode === "paper") {
    const { data: closed } = await sb.from("trades").select("pnl").eq("user_id", userId).eq("mode", "paper").eq("status", "closed");
    const balance = s.paper_balance + (closed || []).reduce((a, t) => a + Number(t.pnl || 0), 0);
    if (todayPnl <= -(balance * s.daily_loss_limit_pct) / 100) fail("Daily loss limit reached. Trading paused until tomorrow (UTC)");
    log(`Paper balance ${balance.toFixed(2)}; today's P/L ${todayPnl.toFixed(2)}`);
    qty = sizePosition({ balance, riskPct: input.riskPct, entry, stop: input.stop });
    log(`Position size ${qty.toFixed(6)} units (risking ${input.riskPct}% = ${(balance * input.riskPct / 100).toFixed(2)}, no leverage)`);
    log(`PAPER fill at ${entry} (simulated, no real order)`);
  } else {
    if (process.env.LIVE_TRADING_ENABLED !== "true") fail("Live trading is disabled on this server (LIVE_TRADING_ENABLED)");
    if (!input.connectionId) fail("Choose an exchange connection");
    connectionId = input.connectionId!;
    const creds = await loadCreds(sb, userId, connectionId);
    if (!creds.testnet && !s.live_enabled) fail("Enable live trading in your risk settings first (this connection uses real money)");
    if (input.side === "sell") fail("Spot connections can only open BUY positions");
    log(`Using ${creds.testnet ? "TESTNET (no real money)" : "LIVE (REAL MONEY)"} connection`);
    const quoteAsset = symbolQuote(input.symbol);
    const balance = await bn.freeBalance(creds, quoteAsset);
    log(`Exchange ${quoteAsset} balance: ${balance}`);
    if (todayPnl <= -(balance * s.daily_loss_limit_pct) / 100) fail("Daily loss limit reached. Trading paused until tomorrow (UTC)");
    const f = await bn.symbolFilters(creds, input.symbol);
    const raw = sizePosition({ balance, riskPct: input.riskPct, entry, stop: input.stop });
    const qtyStr = bn.roundDown(raw, f.stepSize);
    qty = +qtyStr;
    if (qty < +f.minQty || qty * entry < f.minNotional) fail("Position too small for the exchange minimums");
    log(`Position size ${qtyStr} (rounded to exchange step ${f.stepSize})`);
    const fill = await bn.marketOrder(creds, input.symbol, "BUY", qtyStr);
    entry = fill.avgPrice; qty = fill.qty;
    log(`Market BUY filled: ${qty} @ ${entry} (order ${fill.orderId})`);
    try {
      const exitQty = bn.roundDown(qty, f.stepSize);
      const oco = await bn.placeOco(creds, input.symbol, exitQty, bn.roundDown(input.target, f.tickSize),
        bn.roundDown(input.stop, f.tickSize), bn.roundDown(input.stop * 0.998, f.tickSize));
      exchangeRef = { orderListId: oco.orderListId };
      log(`Protective OCO placed on exchange (take-profit ${input.target}, stop ${input.stop})`);
    } catch (e) {
      // Never leave an unprotected live position.
      log(`OCO FAILED: ${(e as Error).message}. Closing position immediately for safety`);
      await bn.marketOrder(creds, input.symbol, "SELL", bn.roundDown(qty, f.stepSize));
      log("Position flattened with market sell");
      await sb.from("trades").insert({
        user_id: userId, mode: "live", connection_id: connectionId, strategy_id: input.strategyId ?? null, symbol: input.symbol,
        side: input.side, qty, entry, stop: input.stop, target: input.target, risk_pct: input.riskPct, status: "closed",
        exit_price: entry, pnl: 0, close_reason: "protective order failed; flattened", steps, closed_at: new Date().toISOString(),
      });
      fail("Could not place protective stop; position was closed. See trade log.");
    }
  }

  const { data, error } = await sb.from("trades").insert({
    user_id: userId, mode: input.mode, connection_id: connectionId, strategy_id: input.strategyId ?? null,
    symbol: input.symbol, side: input.side, qty, entry, stop: input.stop, target: input.target, risk_pct: input.riskPct,
    exchange_ref: exchangeRef, steps,
  }).select("*").single();
  if (error) throw new Error(error.message);
  return data;
}

type TradeRow = {
  id: string; user_id: string; mode: string; connection_id: string | null; symbol: string; side: "buy" | "sell";
  qty: number; entry: number; stop: number; target: number; status: string; steps: Step[]; opened_at: string;
  exchange_ref: { orderListId?: number } | null;
};

async function closeRow(sb: SupabaseClient, t: TradeRow, exit: number, reason: string, extra: string, when = new Date().toISOString()) {
  const dir = t.side === "buy" ? 1 : -1;
  const pnl = dir * (exit - Number(t.entry)) * Number(t.qty);
  const steps = [...t.steps, { at: when, msg: extra }, { at: when, msg: `Closed at ${exit} (${reason}). P/L ${pnl.toFixed(2)}` }];
  const { data } = await sb.from("trades").update({ status: "closed", exit_price: exit, pnl, close_reason: reason, steps, closed_at: when }).eq("id", t.id).select("*").single();
  return data;
}

// Paper trades are checked against real 1-minute candles since entry. Stop wins ties (conservative).
export async function syncPaperTrade(sb: SupabaseClient, t: TradeRow) {
  const candles = await fetchKlines(t.symbol, "1m", 1000, new Date(t.opened_at).getTime());
  for (const c of candles) {
    const stopHit = t.side === "buy" ? c.l <= t.stop : c.h >= t.stop;
    const targetHit = t.side === "buy" ? c.h >= t.target : c.l <= t.target;
    if (stopHit) return closeRow(sb, t, t.stop, "stop loss", "Price touched stop in historical candles", new Date(c.t).toISOString());
    if (targetHit) return closeRow(sb, t, t.target, "take profit", "Price touched target in historical candles", new Date(c.t).toISOString());
  }
  return null;
}

export async function syncLiveTrade(sb: SupabaseClient, t: TradeRow) {
  if (!t.connection_id || !t.exchange_ref?.orderListId) return null;
  const creds = await loadCreds(sb, t.user_id, t.connection_id);
  const st = await bn.getOcoStatus(creds, t.exchange_ref.orderListId);
  if (!st.done) return null;
  for (const o of st.orders) {
    const od = await bn.getOrder(creds, o.symbol, o.orderId);
    if (od.status === "FILLED" && od.executedQty > 0) {
      const exit = od.quote / od.executedQty;
      const reason = exit >= Number(t.entry) ? "take profit" : "stop loss";
      return closeRow(sb, t, exit, reason, "Exchange OCO order filled");
    }
  }
  return null;
}

export async function closeTradeNow(sb: SupabaseClient, userId: string, tradeId: string) {
  const { data: t } = await sb.from("trades").select("*").eq("id", tradeId).eq("user_id", userId).single();
  if (!t || t.status !== "open") throw new Error("Open trade not found");
  if (t.mode === "paper") {
    const price = await fetchPrice(t.symbol);
    return closeRow(sb, t as TradeRow, price, "manual close", `Manual close at market ${price}`);
  }
  const creds = await loadCreds(sb, userId, t.connection_id);
  if (t.exchange_ref?.orderListId) await bn.cancelOco(creds, t.symbol, t.exchange_ref.orderListId);
  const f = await bn.symbolFilters(creds, t.symbol);
  const fill = await bn.marketOrder(creds, t.symbol, "SELL", bn.roundDown(Number(t.qty), f.stepSize));
  return closeRow(sb, t as TradeRow, fill.avgPrice, "manual close", `Cancelled OCO and sold ${fill.qty} at market`);
}
