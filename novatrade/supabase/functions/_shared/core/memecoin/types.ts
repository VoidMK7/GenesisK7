export type MemeChain = "solana" | "ethereum" | "base" | "bsc";
export const MEME_CHAINS: MemeChain[] = ["solana", "base", "ethereum", "bsc"];

/** One token's best trading pair, normalised from a market-data provider. Every field is either real data or absent. */
export interface MemePair {
  chain: MemeChain;
  tokenAddress: string;
  pairAddress: string;
  symbol: string;
  name: string;
  imageUrl?: string;
  dex: string;
  url?: string;
  priceUsd: number;
  liquidityUsd: number;
  volume24hUsd: number;
  fdvUsd?: number;
  ageMinutes?: number;
  buys24h: number;
  sells24h: number;
  buys1h: number;
  sells1h: number;
  change: { m5?: number; h1?: number; h6?: number; h24?: number };
  socials: { website?: string; twitter?: string; telegram?: string };
}

/** Contract-level facts. Only present when a contract scanner is configured and answered. */
export interface OnchainFacts {
  mintAuthorityRenounced?: boolean;
  freezeAuthorityRenounced?: boolean;
  top10HoldersPct?: number;
  lpLockedPct?: number;
  source: string;
}

export interface MemeStrategy {
  enabled: boolean;
  mode: "analysis" | "paper" | "live_approval" | "live";
  chains: MemeChain[];
  minLiquidityUsd: number;
  minVolume24hUsd: number;
  minAgeMinutes: number;
  maxAgeHours: number;
  maxFdvUsd?: number;
  minBuySellRatio: number;
  minRugScore: number;
  positionUsd: number;
  maxOpenPositions: number;
  takeProfitPct: number;
  stopLossPct: number;
  trailingStopPct: number;
  slippageBps: number;
  dailyLossLimitUsd?: number;
}

export const DEFAULT_STRATEGY: MemeStrategy = {
  enabled: false, mode: "paper", chains: ["solana"], minLiquidityUsd: 20_000, minVolume24hUsd: 50_000, minAgeMinutes: 30, maxAgeHours: 72,
  minBuySellRatio: 1, minRugScore: 60, positionUsd: 50, maxOpenPositions: 5, takeProfitPct: 100, stopLossPct: 25, trailingStopPct: 20, slippageBps: 300,
};
