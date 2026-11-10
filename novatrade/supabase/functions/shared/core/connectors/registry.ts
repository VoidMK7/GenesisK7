import type { BrokerConnector, ConnectorCapabilities, ConnectorCredentials } from "./types.ts";
import { AlpacaConnector } from "./alpaca.ts";
import { BinanceConnector } from "./binance.ts";
import { OandaConnector } from "./oanda.ts";

export type SupportLevel = "supported" | "not_supported";

export interface ConnectorInfo {
  id: string;
  name: string;
  support: SupportLevel;
  assetClasses: string[];
  authMethod: string;
  credentialFields: { key: "apiKey" | "apiSecret" | "accountId"; label: string; required: boolean }[];
  capabilities?: ConnectorCapabilities;
  limitations: string[];
  regionNote?: string;
  create?: (c: ConnectorCredentials) => BrokerConnector;
}

const caps = (c: BrokerConnector["capabilities"]) => c;

export const CONNECTORS: ConnectorInfo[] = [
  {
    id: "alpaca", name: "Alpaca", support: "supported", assetClasses: ["Stocks", "ETFs", "Crypto"], authMethod: "API key + secret (Trading API)",
    credentialFields: [{ key: "apiKey", label: "API key ID", required: true }, { key: "apiSecret", label: "Secret key", required: true }],
    capabilities: caps({ assetClasses: ["stocks", "etf", "crypto"], orderTypes: ["market", "limit"], stopLoss: true, takeProfit: true, modifyOrder: true, shorting: true, paperEnvironment: true }),
    limitations: ["Bracket / stop attachments are not available on crypto orders.", "US-focused; account eligibility depends on your jurisdiction."],
    create: (c) => new AlpacaConnector(c),
  },
  {
    id: "oanda", name: "OANDA", support: "supported", assetClasses: ["Forex", "Commodities (CFD)", "Indices (CFD)"], authMethod: "Personal access token + account ID (v20 API)",
    credentialFields: [{ key: "apiKey", label: "Access token", required: true }, { key: "accountId", label: "Account ID", required: true }],
    capabilities: caps({ assetClasses: ["forex", "commodities", "indices"], orderTypes: ["market", "limit"], stopLoss: true, takeProfit: true, modifyOrder: true, shorting: true, paperEnvironment: true }),
    limitations: ["Instrument availability depends on your OANDA region and account type."],
    regionNote: "Not available in all countries.",
    create: (c) => new OandaConnector(c),
  },
  {
    id: "binance", name: "Binance (Spot)", support: "supported", assetClasses: ["Crypto"], authMethod: "API key + secret (trade-only, IP-restricted recommended)",
    credentialFields: [{ key: "apiKey", label: "API key", required: true }, { key: "apiSecret", label: "API secret", required: true }],
    capabilities: caps({ assetClasses: ["crypto"], orderTypes: ["market", "limit"], stopLoss: false, takeProfit: false, modifyOrder: false, shorting: false, paperEnvironment: true }),
    limitations: ["Places entry orders only: cannot attach stop-loss or take-profit, so live orders are blocked while 'require stop-loss' is on.", "Order modification is not supported (cancel and re-place).", "Spot only; no futures or margin."],
    regionNote: "Binance.com is unavailable in some regions (including the US). Binance.US uses a different API and is not covered.",
    create: (c) => new BinanceConnector(c),
  },
  { id: "bybit", name: "Bybit", support: "not_supported", assetClasses: ["Crypto"], authMethod: "API key", credentialFields: [], limitations: ["Connector not built yet. Market data and trading from NovaTrade are not available for this exchange."] },
  { id: "okx", name: "OKX", support: "not_supported", assetClasses: ["Crypto"], authMethod: "API key + passphrase", credentialFields: [], limitations: ["Connector not built yet."] },
  { id: "coinbase", name: "Coinbase", support: "not_supported", assetClasses: ["Crypto"], authMethod: "CDP API key", credentialFields: [], limitations: ["Connector not built yet."] },
  { id: "kraken", name: "Kraken", support: "not_supported", assetClasses: ["Crypto"], authMethod: "API key", credentialFields: [], limitations: ["Connector not built yet."] },
  { id: "ibkr", name: "Interactive Brokers", support: "not_supported", assetClasses: ["Stocks", "Futures", "Forex", "Options"], authMethod: "Client Portal / TWS gateway", credentialFields: [], limitations: ["Needs a locally run gateway session; cannot be connected with a stored key. Not built."] },
  { id: "mt5", name: "MetaTrader 5 brokers", support: "not_supported", assetClasses: ["Forex", "CFD"], authMethod: "none (no public broker-neutral API)", credentialFields: [], limitations: ["MetaTrader has no public trading API for third-party web apps. Execution is not possible through NovaTrade."] },
];

export const getConnectorInfo = (id: string) => CONNECTORS.find((c) => c.id === id);

export function createConnector(id: string, creds: ConnectorCredentials): BrokerConnector {
  const info = getConnectorInfo(id);
  if (!info || info.support !== "supported" || !info.create) throw new Error(`Connector "${id}" is not supported.`);
  return info.create(creds);
}
