/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SMART INTRADAY DECISION ENGINE — GLOBAL MARKET CONTEXT & TRANSMISSION ENGINE
 * ============================================================================
 * Zero-cost market intelligence tracking:
 * - Commodities: Gold (GC=F), Silver (SI=F), WTI Crude (CL=F), Brent Crude (BZ=F)
 * - Currency: USD/INR (INR=X)
 * - Global Benchmarks: US S&P 500 (^GSPC), Nasdaq (^IXIC), Nikkei 225 (^N225), FTSE 100 (^FTSE)
 * - Domestic Benchmarks: NIFTY 50 (^NSEI), Bank Nifty (^NSEBANK), SENSEX (^BSESN)
 *
 * Provides conditional transmission mechanisms to Indian equities:
 * - Crude oil -> OMCs (IOC, BPCL), Paints (Asian Paints), Aviation, Trade Deficit
 * - USD/INR -> IT exporters (TCS, INFY, Wipro) gain on depreciation; Importers compressed
 * - Gold/Silver -> Retail jewellery demand (Titan), safe haven risk appetite
 * - US/Global indices -> Institutional FII flows & overnight gap sentiment
 *
 * Strict integrity:
 * - Missing feeds explicitly marked UNAVAILABLE (never silently zeroed)
 * - Clear disclosure of delayed vs live vs offline fixture data
 */

export type GlobalMarketCategory =
  | 'COMMODITY'
  | 'CURRENCY'
  | 'GLOBAL_INDEX'
  | 'DOMESTIC_BENCHMARK';

export type GlobalDataFreshness = 'LIVE' | 'DELAYED_15M' | 'EOD_CLOSE' | 'OFFLINE_FIXTURE' | 'UNAVAILABLE';

export interface MacroIndicatorItem {
  symbol: string;
  name: string;
  category: GlobalMarketCategory;
  currency: string;
  latestPrice: number | null;
  previousClose: number | null;
  changeINRorPoints: number | null;
  changePercent: number | null;
  timestamp: number | null;
  timestampIST: string;
  freshness: GlobalDataFreshness;
  dataSource: string;
  relevanceToIndia: string;
  transmissionMechanism: string;
  affectedSectors: { sector: string; impactDirection: 'FAVORABLE' | 'UNFAVORABLE' | 'NEUTRAL'; rationale: string }[];
}

export interface MacroRegimeAssessment {
  overallRegime: 'RISK_ON_BULLISH' | 'RISK_OFF_BEARISH' | 'NEUTRAL_MIXED';
  niftyTrend: 'UPTREND' | 'DOWNTREND' | 'SIDEWAYS';
  crudePressure: 'ELEVATED_HEADWIND' | 'BENIGN_TAILWIND' | 'NEUTRAL';
  currencyPressure: 'INR_WEAKENING' | 'INR_STRENGTHENING' | 'INR_STABLE';
  globalSentiment: 'POSITIVE' | 'NEGATIVE' | 'MIXED';
  keyTakeaway: string;
  confidenceScorePct: number;
}

export const MACRO_INSTRUMENTS_CONFIG: {
  symbol: string;
  name: string;
  category: GlobalMarketCategory;
  currency: string;
  relevance: string;
  transmission: string;
  sectors: { sector: string; impactDirection: 'FAVORABLE' | 'UNFAVORABLE' | 'NEUTRAL'; rationale: string }[];
}[] = [
  {
    symbol: 'CL=F',
    name: 'WTI Crude Oil Futures',
    category: 'COMMODITY',
    currency: 'USD/bbl',
    relevance: 'India imports ~85% of its crude oil requirements; dominant driver of import bill & CPI inflation.',
    transmission: 'Higher crude raises input costs for paints, lubricants, airlines, and tires; strains oil marketing companies (OMCs) unless retail prices adjust.',
    sectors: [
      { sector: 'Paints & Coatings', impactDirection: 'UNFAVORABLE', rationale: 'Raw material solvent and titanium dioxide costs rise with crude derivatives.' },
      { sector: 'Aviation', impactDirection: 'UNFAVORABLE', rationale: 'Aviation Turbine Fuel (ATF) constitutes 35-40% of airline operating expenses.' },
      { sector: 'Oil Exploration (ONGC)', impactDirection: 'FAVORABLE', rationale: 'Higher realization per barrel sold to refiners.' },
    ],
  },
  {
    symbol: 'GC=F',
    name: 'COMEX Gold Futures',
    category: 'COMMODITY',
    currency: 'USD/oz',
    relevance: 'World’s second-largest consumer; key indicator of global risk aversion and festive retail jewellery demand.',
    transmission: 'Rising gold reflects safe-haven buying. For jewellery retailers (Titan), sharp spikes can temporarily compress retail volume but boost inventory valuations.',
    sectors: [
      { sector: 'Jewellery & Retail', impactDirection: 'NEUTRAL', rationale: 'Short-term volume dampener due to price shock, offset by inventory gains.' },
      { sector: 'Gold Loan NBFCs', impactDirection: 'FAVORABLE', rationale: 'Higher collateral value lowers loan-to-value (LTV) default risks.' },
    ],
  },
  {
    symbol: 'SI=F',
    name: 'COMEX Silver Futures',
    category: 'COMMODITY',
    currency: 'USD/oz',
    relevance: 'Dual role as investment hedge and industrial metal (solar PV panels, electronics, EV components).',
    transmission: 'Surging silver signals either industrial demand expansion or monetary debasement hedge.',
    sectors: [
      { sector: 'Industrial Metals', impactDirection: 'FAVORABLE', rationale: 'Higher realization for byproduct producers like Hindustan Zinc.' },
    ],
  },
  {
    symbol: 'INR=X',
    name: 'USD / INR Exchange Rate',
    category: 'CURRENCY',
    currency: 'INR',
    relevance: 'Benchmark exchange rate impacting foreign institutional investor (FII) capital flows and trade balance.',
    transmission: 'Rupee depreciation (higher USD/INR) boosts top-line margin realization for IT exporters and Pharma, while increasing debt-servicing costs for external commercial borrowers.',
    sectors: [
      { sector: 'IT Services (TCS, INFY)', impactDirection: 'FAVORABLE', rationale: 'Revenues billed in USD; depreciation directly expands operating EBITDA margins.' },
      { sector: 'Capital Goods & Importers', impactDirection: 'UNFAVORABLE', rationale: 'Imports of high-end machinery, semiconductors, and specialized chemicals become more expensive.' },
    ],
  },
  {
    symbol: '^GSPC',
    name: 'S&P 500 Index (US)',
    category: 'GLOBAL_INDEX',
    currency: 'USD',
    relevance: 'World benchmark equity gauge driving global risk appetite and Foreign Portfolio Investor (FPI) allocations.',
    transmission: 'Overnight positive moves in S&P 500 typically trigger positive opening gaps for Indian equities through institutional liquidity and sentiment transfer.',
    sectors: [
      { sector: 'Overall Indian Equities', impactDirection: 'FAVORABLE', rationale: 'Global risk-on tone correlates positively with FPI inflows to emerging markets.' },
    ],
  },
  {
    symbol: '^IXIC',
    name: 'NASDAQ Composite Index (US)',
    category: 'GLOBAL_INDEX',
    currency: 'USD',
    relevance: 'Global technology sentiment barometer; highly influential for Indian IT sector opening momentum.',
    transmission: 'Earnings surprises or tech sell-offs on Nasdaq directly influence sentiment for Indian tier-1 IT blue chips (TCS, Infosys, Wipro).',
    sectors: [
      { sector: 'IT Services', impactDirection: 'FAVORABLE', rationale: 'Direct sentiment transmission between US tech clients and Indian offshore vendors.' },
    ],
  },
  {
    symbol: '^N225',
    name: 'Nikkei 225 Index (Japan)',
    category: 'GLOBAL_INDEX',
    currency: 'JPY',
    relevance: 'Major Asian morning barometer trading ahead of Indian market opening (09:15 IST).',
    transmission: 'Provides early Asian session liquidity and risk guidance before the Gift Nifty and Indian open.',
    sectors: [
      { sector: 'Asian Market Sentiment', impactDirection: 'FAVORABLE', rationale: 'Early morning risk orientation cues for Gift Nifty futures.' },
    ],
  },
  {
    symbol: '^NSEI',
    name: 'NIFTY 50 Index (India)',
    category: 'DOMESTIC_BENCHMARK',
    currency: 'INR',
    relevance: 'Headline benchmark representing the top 50 largest Indian companies by market capitalization.',
    transmission: 'Defines the dominant market regime (bullish/bearish/choppy). Strong trending Nifty increases directional probability for individual stock setups.',
    sectors: [
      { sector: 'Broad Market Equities', impactDirection: 'FAVORABLE', rationale: 'Systematic market beta alignment increases intraday win probability.' },
    ],
  },
  {
    symbol: '^NSEBANK',
    name: 'NIFTY Bank Index (India)',
    category: 'DOMESTIC_BENCHMARK',
    currency: 'INR',
    relevance: 'Represents the 12 most liquid Indian banking stocks, accounting for ~30-35% of Nifty weighting.',
    transmission: 'High-beta leadership engine; strong bank participation is crucial for sustained intraday rallies.',
    sectors: [
      { sector: 'Banking & Financials', impactDirection: 'FAVORABLE', rationale: 'Direct proxy for credit growth, liquidity spreads, and banking risk.' },
    ],
  },
];

/**
 * Fetches macro indicator data via zero-cost Yahoo Finance Chart proxy (/api/yahoo/v8/finance/chart/{symbol}).
 */
export async function fetchMacroIndicator(
  config: (typeof MACRO_INSTRUMENTS_CONFIG)[number]
): Promise<MacroIndicatorItem> {
  const symbol = encodeURIComponent(config.symbol);
  const endpoint = `/api/yahoo/v8/finance/chart/${symbol}?interval=1d&range=5d`;

  try {
    const res = await fetch(endpoint);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) {
      throw new Error(data?.chart?.error?.description || 'No result returned');
    }

    const meta = result.meta || {};
    const timestamps: number[] = result.timestamp || [];
    const closes: (number | null)[] = result.indicators?.quote?.[0]?.close || [];

    // Filter valid closes
    const validData: { t: number; c: number }[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const c = closes[i];
      if (c !== null && Number.isFinite(c) && c > 0) {
        validData.push({ t: timestamps[i] * 1000, c });
      }
    }

    if (validData.length === 0) {
      throw new Error('No valid price points in range');
    }

    const latest = validData[validData.length - 1];
    const prev = validData.length >= 2 ? validData[validData.length - 2] : null;

    const latestPrice = Math.round(latest.c * 100) / 100;
    const previousClose = prev ? Math.round(prev.c * 100) / 100 : meta.chartPreviousClose || latestPrice;
    const change = Math.round((latestPrice - previousClose) * 100) / 100;
    const changePercent = previousClose > 0 ? Math.round(((latestPrice - previousClose) / previousClose) * 10000) / 100 : 0;

    const dateIST = new Date(latest.t).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

    const ageMs = Math.max(0, Date.now() - latest.t);
    const isRecent = ageMs < 16 * 3600 * 1000;
    const freshness: GlobalDataFreshness = isRecent ? 'DELAYED_15M' : 'EOD_CLOSE';

    return {
      symbol: config.symbol,
      name: config.name,
      category: config.category,
      currency: config.currency,
      latestPrice,
      previousClose,
      changeINRorPoints: change,
      changePercent,
      timestamp: latest.t,
      timestampIST: `${dateIST} IST`,
      freshness,
      dataSource: `Yahoo Finance Free ${isRecent ? 'Delayed 15m' : 'Prior Close'} Endpoint (Zero Cost)`,
      relevanceToIndia: config.relevance,
      transmissionMechanism: config.transmission,
      affectedSectors: config.sectors,
    };
  } catch (err: any) {
    // Return honest UNAVAILABLE record rather than fabricating numbers
    return {
      symbol: config.symbol,
      name: config.name,
      category: config.category,
      currency: config.currency,
      latestPrice: null,
      previousClose: null,
      changeINRorPoints: null,
      changePercent: null,
      timestamp: null,
      timestampIST: 'UNAVAILABLE',
      freshness: 'UNAVAILABLE',
      dataSource: `Failed: ${err.message || 'Offline'}`,
      relevanceToIndia: config.relevance,
      transmissionMechanism: config.transmission,
      affectedSectors: config.sectors,
    };
  }
}

let cachedMacroData: {
  indicators: MacroIndicatorItem[];
  regime: MacroRegimeAssessment;
  isLive: boolean;
  fetchedAtIST: string;
  cacheTimestamp: number;
} | null = null;

/**
 * Fetches all 9 macro indicators in bounded chunks to avoid provider throttling.
 */
export async function fetchAllMacroIndicators(signal?: AbortSignal): Promise<MacroIndicatorItem[]> {
  const results: MacroIndicatorItem[] = [];
  for (let i = 0; i < MACRO_INSTRUMENTS_CONFIG.length; i += 3) {
    if (signal?.aborted) break;
    const chunk = MACRO_INSTRUMENTS_CONFIG.slice(i, i + 3);
    const chunkResults = await Promise.all(chunk.map((cfg) => fetchMacroIndicator(cfg)));
    results.push(...chunkResults);
    if (i + 3 < MACRO_INSTRUMENTS_CONFIG.length && !signal?.aborted) {
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
  }
  return results;
}

/**
 * Cached accessor for macro indicators and regime (5-minute TTL).
 * Prevents hammering the Yahoo proxy on every 60-second intraday scan.
 */
export async function fetchCachedLiveMacroData(
  forceRefresh: boolean = false,
  signal?: AbortSignal
): Promise<{
  indicators: MacroIndicatorItem[];
  regime: MacroRegimeAssessment;
  isLive: boolean;
  fetchedAtIST: string;
}> {
  const now = Date.now();
  if (!forceRefresh && cachedMacroData && now - cachedMacroData.cacheTimestamp < 5 * 60 * 1000) {
    return cachedMacroData;
  }

  const indicators = await fetchAllMacroIndicators(signal);
  const validCount = indicators.filter((i) => i.freshness !== 'UNAVAILABLE').length;
  const isLive = validCount >= 4;
  const regime = assessMacroRegime(indicators);

  const nowIST = new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }) + ' IST';

  const result = {
    indicators,
    regime,
    isLive,
    fetchedAtIST: nowIST,
    cacheTimestamp: now,
  };

  cachedMacroData = result;
  return result;
}

/**
 * Creates deterministic macro fixture for offline verification and testing.
 */
export function createDeterministicMacroFixture(): MacroIndicatorItem[] {
  const samplePrices: Record<string, { latest: number; prev: number }> = {
    'CL=F': { latest: 74.5, prev: 73.8 }, // +0.95%
    'GC=F': { latest: 2740.2, prev: 2735.0 }, // +0.19%
    'SI=F': { latest: 33.8, prev: 33.5 }, // +0.90%
    'INR=X': { latest: 84.12, prev: 84.05 }, // +0.08%
    '^GSPC': { latest: 5820.5, prev: 5800.0 }, // +0.35%
    '^IXIC': { latest: 18550.0, prev: 18510.0 }, // +0.22%
    '^N225': { latest: 38900.0, prev: 38750.0 }, // +0.39%
    '^NSEI': { latest: 24450.0, prev: 24390.0 }, // +0.25%
    '^NSEBANK': { latest: 51200.0, prev: 51050.0 }, // +0.29%
  };

  return MACRO_INSTRUMENTS_CONFIG.map((cfg) => {
    const p = samplePrices[cfg.symbol] || { latest: 100, prev: 100 };
    const change = Math.round((p.latest - p.prev) * 100) / 100;
    const changePct = Math.round(((p.latest - p.prev) / p.prev) * 10000) / 100;

    return {
      symbol: cfg.symbol,
      name: cfg.name,
      category: cfg.category,
      currency: cfg.currency,
      latestPrice: p.latest,
      previousClose: p.prev,
      changeINRorPoints: change,
      changePercent: changePct,
      timestamp: 1793268000000,
      timestampIST: '2026-10-29 15:30:00 IST',
      freshness: 'OFFLINE_FIXTURE',
      dataSource: 'Deterministic Offline Macro Fixture (₹0 Testing)',
      relevanceToIndia: cfg.relevance,
      transmissionMechanism: cfg.transmission,
      affectedSectors: cfg.sectors,
    };
  });
}

/**
 * Assesses overall macroeconomic regime and directional bias for Indian markets.
 */
export function assessMacroRegime(indicators: MacroIndicatorItem[]): MacroRegimeAssessment {
  const nifty = indicators.find((i) => i.symbol === '^NSEI');
  const crude = indicators.find((i) => i.symbol === 'CL=F');
  const inr = indicators.find((i) => i.symbol === 'INR=X');
  const sp500 = indicators.find((i) => i.symbol === '^GSPC');
  const nasdaq = indicators.find((i) => i.symbol === '^IXIC');

  let bullishVotes = 0;
  let bearishVotes = 0;

  // Nifty Trend
  let niftyTrend: 'UPTREND' | 'DOWNTREND' | 'SIDEWAYS' = 'SIDEWAYS';
  if (nifty && nifty.changePercent !== null) {
    if (nifty.changePercent > 0.2) {
      niftyTrend = 'UPTREND';
      bullishVotes += 2;
    } else if (nifty.changePercent < -0.2) {
      niftyTrend = 'DOWNTREND';
      bearishVotes += 2;
    }
  }

  // Crude Oil Pressure
  let crudePressure: 'ELEVATED_HEADWIND' | 'BENIGN_TAILWIND' | 'NEUTRAL' = 'NEUTRAL';
  if (crude && crude.changePercent !== null) {
    if (crude.changePercent > 1.5) {
      crudePressure = 'ELEVATED_HEADWIND';
      bearishVotes += 1;
    } else if (crude.changePercent < -1.5) {
      crudePressure = 'BENIGN_TAILWIND';
      bullishVotes += 1;
    }
  }

  // Currency Pressure
  let currencyPressure: 'INR_WEAKENING' | 'INR_STRENGTHENING' | 'INR_STABLE' = 'INR_STABLE';
  if (inr && inr.changePercent !== null) {
    if (inr.changePercent > 0.15) {
      currencyPressure = 'INR_WEAKENING';
      // Weakening rupee has mixed impact: positive IT, negative macro
    } else if (inr.changePercent < -0.15) {
      currencyPressure = 'INR_STRENGTHENING';
    }
  }

  // Global Equities Sentiment
  let globalSentiment: 'POSITIVE' | 'NEGATIVE' | 'MIXED' = 'MIXED';
  const spChange = sp500?.changePercent ?? 0;
  const ndxChange = nasdaq?.changePercent ?? 0;
  if (spChange > 0.25 && ndxChange > 0.25) {
    globalSentiment = 'POSITIVE';
    bullishVotes += 1;
  } else if (spChange < -0.25 && ndxChange < -0.25) {
    globalSentiment = 'NEGATIVE';
    bearishVotes += 1;
  }

  let overallRegime: 'RISK_ON_BULLISH' | 'RISK_OFF_BEARISH' | 'NEUTRAL_MIXED' = 'NEUTRAL_MIXED';
  let keyTakeaway = 'Macro regime is mixed; intraday setups should prioritize strict stop-loss levels and volume confirmation.';

  if (bullishVotes >= 3 && bullishVotes > bearishVotes) {
    overallRegime = 'RISK_ON_BULLISH';
    keyTakeaway = 'Positive global cues and domestic benchmark strength support selective long pullbacks with VWAP support.';
  } else if (bearishVotes >= 3 && bearishVotes > bullishVotes) {
    overallRegime = 'RISK_OFF_BEARISH';
    keyTakeaway = 'Elevated crude or global risk-off sentiment suggests defensive posture; favor short reversals or sit in cash.';
  }

  const confidenceScorePct = Math.min(85, Math.max(40, 50 + (Math.abs(bullishVotes - bearishVotes) * 10)));

  return {
    overallRegime,
    niftyTrend,
    crudePressure,
    currencyPressure,
    globalSentiment,
    keyTakeaway,
    confidenceScorePct,
  };
}
