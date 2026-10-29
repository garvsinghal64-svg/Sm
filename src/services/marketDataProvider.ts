/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AUTHORITATIVE_TIMEZONE, getCurrentISTDate } from '../utils/dateEngine.ts';

export interface InstrumentConfig {
  symbol: string;
  name: string;
  exchange: 'NSE' | 'BSE';
  type: 'INDEX' | 'EQUITY';
  displayOrder: number;
}

export const SUPPORTED_INSTRUMENTS: InstrumentConfig[] = [
  { symbol: '^NSEI', name: 'Nifty 50', exchange: 'NSE', type: 'INDEX', displayOrder: 1 },
  { symbol: '^NSEBANK', name: 'Bank Nifty', exchange: 'NSE', type: 'INDEX', displayOrder: 2 },
  { symbol: '^BSESN', name: 'Sensex', exchange: 'BSE', type: 'INDEX', displayOrder: 3 },
  { symbol: 'RELIANCE.NS', name: 'Reliance Industries', exchange: 'NSE', type: 'EQUITY', displayOrder: 4 },
  { symbol: 'TCS.NS', name: 'Tata Consultancy Services', exchange: 'NSE', type: 'EQUITY', displayOrder: 5 },
  { symbol: 'INFY.NS', name: 'Infosys', exchange: 'NSE', type: 'EQUITY', displayOrder: 6 },
  { symbol: 'HDFCBANK.NS', name: 'HDFC Bank', exchange: 'NSE', type: 'EQUITY', displayOrder: 7 },
];

export interface ProviderDisclosures {
  name: string;
  endpoint: string;
  delayNotice: string;
  marketHoursNotice: string;
  legalNotice: string;
  proxyNotice: string;
}

export const YAHOO_PROVIDER_DISCLOSURES: ProviderDisclosures = {
  name: 'Yahoo Finance (Chart API)',
  endpoint: '/api/yahoo/v8/finance/chart/{symbol}?range=1d&interval=1d',
  delayNotice: 'Exchange data delay is not verifiable from provider payload (exchangeDataDelayedBy is undefined). Latency is explicitly disclosed as "delay not verified" rather than assuming 15 minutes.',
  marketHoursNotice: 'Outside trading hours and on weekends/holidays, quotes represent the latest available official session close (EOD). Successive refreshes during market closure will return the same closing quote.',
  legalNotice: 'Free public prototype data source. Quotes are not guaranteed for accuracy, latency, or commercial redistribution.',
  proxyNotice: 'Requires a server-side proxy (Vite dev proxy during development, or Node.js Express server.ts in production) to comply with browser Cross-Origin Resource Sharing (CORS) security restrictions.',
};

export interface MarketQuote {
  symbol: string;
  name: string;
  exchange: 'NSE' | 'BSE' | string;
  type: 'INDEX' | 'EQUITY';
  currency: string;
  price: number;
  previousClose: number | null;
  change: number;
  changePercent: number;
  dayHigh: number | null;
  dayLow: number | null;
  volume: number | null;
  dataSource: string;
  quoteTimestamp: number; // in milliseconds (source timestamp from regularMarketTime)
  quoteTimestampIST: string;
  fetchedAt: number; // in milliseconds (client fetch time)
  fetchedAtIST: string;
  isDelayedOrStale: boolean;
  staleReason: string;
  dataDelayDisclosure: string; // 'delay not verified' or verified delay
  exchangeDataDelayedBy: number | null;
  freshnessStatus: 'LIVE_SESSION' | 'CLOSED_EOD' | 'PRESERVED_STALE';
  isPreservedStaleOnFailure?: boolean;
}

export interface MarketFetchResult {
  quotes: MarketQuote[];
  fetchTimeIST: string;
  fetchTimestamp: number;
  allSucceeded: boolean;
  errors: Record<string, string>;
  isStale: boolean;
  dataSource: string;
}

export interface MarketDataProviderOptions {
  baseUrl?: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Format any epoch timestamp (seconds or ms) into formatted IST string
 */
export function formatISTTime(epochSecondsOrMs: number): string {
  if (!epochSecondsOrMs || isNaN(epochSecondsOrMs)) return 'N/A';
  const ms = epochSecondsOrMs < 10000000000 ? epochSecondsOrMs * 1000 : epochSecondsOrMs;
  const d = new Date(ms);
  if (isNaN(d.getTime())) return 'Invalid Date';

  const ist = getCurrentISTDate(d, true);
  return `${ist.dateString} ${ist.timeString12} IST`;
}

/**
 * Format currency in Indian Rupees with Indian numbering system (Lakhs & Crores)
 */
export function formatINR(val: number | null | undefined): string {
  if (val === null || val === undefined || isNaN(val)) return '₹--';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(val);
}

/**
 * Format volume in Indian numbering (Crores/Lakhs or formatted string)
 */
export function formatVolume(volume: number | null | undefined): string {
  if (volume === null || volume === undefined || isNaN(volume) || volume === 0) {
    return 'N/A';
  }
  if (volume >= 10000000) {
    return `${(volume / 10000000).toFixed(2)} Cr`;
  }
  if (volume >= 100000) {
    return `${(volume / 100000).toFixed(2)} L`;
  }
  return new Intl.NumberFormat('en-IN').format(volume);
}

/**
 * Parse raw Yahoo Finance chart API response for a single instrument
 * Verifies source timestamp, fetch timestamp, data delay, and freshness without assumptions
 */
export function parseYahooChartResponse(
  rawJson: any,
  symbol: string,
  fetchedAtMs: number = Date.now()
): MarketQuote {
  if (!rawJson || typeof rawJson !== 'object') {
    throw new Error(`Invalid JSON response received for symbol ${symbol}`);
  }

  const result = rawJson.chart?.result?.[0];
  if (!result) {
    const errorMsg = rawJson.chart?.error?.description || 'No result data found in response';
    throw new Error(`Yahoo Finance error for ${symbol}: ${errorMsg}`);
  }

  const meta = result.meta;
  if (!meta || typeof meta !== 'object') {
    throw new Error(`Missing meta block in chart response for ${symbol}`);
  }

  const config = SUPPORTED_INSTRUMENTS.find((i) => i.symbol === symbol);
  const name = config?.name || meta.shortName || meta.longName || symbol;
  const exchange = config?.exchange || (meta.exchangeName === 'BSE' ? 'BSE' : 'NSE');
  const type = config?.type || (meta.instrumentType === 'INDEX' ? 'INDEX' : 'EQUITY');
  const currency = meta.currency || 'INR';

  // Strict price validation: must be a positive finite number
  const regularPrice = meta.regularMarketPrice;
  if (typeof regularPrice !== 'number' || isNaN(regularPrice) || !isFinite(regularPrice) || regularPrice <= 0) {
    throw new Error(`Invalid or missing regularMarketPrice for ${symbol}: received ${regularPrice}`);
  }

  const prevClose = typeof meta.chartPreviousClose === 'number' && !isNaN(meta.chartPreviousClose)
    ? meta.chartPreviousClose
    : null;

  let change = 0;
  let changePercent = 0;

  if (prevClose !== null && prevClose > 0) {
    change = Number((regularPrice - prevClose).toFixed(2));
    changePercent = Number((((regularPrice - prevClose) / prevClose) * 100).toFixed(2));
  } else if (typeof meta.regularMarketChangePercent === 'number' && !isNaN(meta.regularMarketChangePercent)) {
    changePercent = Number(meta.regularMarketChangePercent.toFixed(2));
  }

  // Source timestamp validation
  const quoteSec = meta.regularMarketTime;
  if (typeof quoteSec !== 'number' || isNaN(quoteSec) || quoteSec <= 0) {
    throw new Error(`Invalid or missing regularMarketTime for ${symbol}: received ${quoteSec}`);
  }
  const quoteTimestampMs = quoteSec * 1000;

  // Extract trading volume: either from meta or first candle in indicators.quote
  const metaVolume = typeof meta.regularMarketVolume === 'number' ? meta.regularMarketVolume : null;
  const candleVolume = result.indicators?.quote?.[0]?.volume?.[0];
  const volume = metaVolume !== null ? metaVolume : (typeof candleVolume === 'number' ? candleVolume : null);

  const dayHigh = typeof meta.regularMarketDayHigh === 'number' ? meta.regularMarketDayHigh : null;
  const dayLow = typeof meta.regularMarketDayLow === 'number' ? meta.regularMarketDayLow : null;

  // Audit data delay disclosure: Do NOT infer or assume 15 minutes!
  // If exchangeDataDelayedBy is explicitly provided in meta as a number, use it.
  // Otherwise, label it strictly as 'delay not verified'.
  const rawDelay = meta.exchangeDataDelayedBy;
  let dataDelayDisclosure = 'delay not verified';
  let exchangeDataDelayedBy: number | null = null;
  if (typeof rawDelay === 'number' && !isNaN(rawDelay)) {
    exchangeDataDelayedBy = rawDelay;
    dataDelayDisclosure = rawDelay === 0 ? 'real-time (0m delay)' : `${rawDelay}m delay`;
  } else {
    dataDelayDisclosure = 'delay not verified';
  }

  // Calculate session freshness based on actual source timestamp and trading period
  const tradingPeriodRegular = meta.currentTradingPeriod?.regular;
  let isSessionClosed = false;
  if (tradingPeriodRegular && typeof tradingPeriodRegular.end === 'number') {
    const nowSec = Math.floor(fetchedAtMs / 1000);
    if (nowSec > tradingPeriodRegular.end || nowSec < tradingPeriodRegular.start) {
      isSessionClosed = true;
    }
  } else {
    // If no trading period provided, check if quote is older than 4 hours
    const quoteAgeMinutes = (fetchedAtMs - quoteTimestampMs) / (60 * 1000);
    if (quoteAgeMinutes > 240) {
      isSessionClosed = true;
    }
  }

  const freshnessStatus: 'LIVE_SESSION' | 'CLOSED_EOD' | 'PRESERVED_STALE' = isSessionClosed ? 'CLOSED_EOD' : 'LIVE_SESSION';
  const isDelayedOrStale = isSessionClosed;
  const staleReason = isSessionClosed
    ? 'Market session closed. Quote represents latest available official session close (EOD).'
    : `Latest available quote from active session (${dataDelayDisclosure}).`;

  const fetchIST = formatISTTime(fetchedAtMs);
  const quoteIST = formatISTTime(quoteTimestampMs);

  return {
    symbol,
    name,
    exchange,
    type,
    currency,
    price: regularPrice,
    previousClose: prevClose,
    change,
    changePercent,
    dayHigh,
    dayLow,
    volume,
    dataSource: 'Yahoo Finance (v8 Chart API)',
    quoteTimestamp: quoteTimestampMs,
    quoteTimestampIST: quoteIST,
    fetchedAt: fetchedAtMs,
    fetchedAtIST: fetchIST,
    isDelayedOrStale,
    staleReason,
    dataDelayDisclosure,
    exchangeDataDelayedBy,
    freshnessStatus,
    isPreservedStaleOnFailure: false,
  };
}

/**
 * Marks an existing quote as preserved stale upon a failed refresh
 */
export function markQuoteAsPreservedStale(
  previousQuote: MarketQuote,
  errorMsg: string,
  failedAtMs: number = Date.now()
): MarketQuote {
  const failedAtIST = formatISTTime(failedAtMs);
  return {
    ...previousQuote,
    isDelayedOrStale: true,
    isPreservedStaleOnFailure: true,
    freshnessStatus: 'PRESERVED_STALE',
    staleReason: `Refresh failed at ${failedAtIST} (${errorMsg}). Preserving previously fetched data.`,
  };
}

/**
 * Standard Market Data Provider interface allowing future drop-in replacement
 */
export interface IMarketDataProvider {
  getQuotes(symbols?: string[]): Promise<MarketFetchResult>;
  getQuote(symbol: string): Promise<MarketQuote>;
}

/**
 * Yahoo Finance Market Data Provider Implementation
 */
export class YahooFinanceMarketProvider implements IMarketDataProvider {
  private baseUrl: string;
  private fetchFn: typeof fetch;
  private timeoutMs: number;
  private inFlightRequest: Promise<MarketFetchResult> | null = null;
  private lastSuccessfulQuotes: Map<string, MarketQuote> = new Map();

  constructor(options: MarketDataProviderOptions = {}) {
    // In browser environment, use relative proxy /api/yahoo
    // In Node test/server environment, if not specified use direct Yahoo Finance URL
    const isBrowser = typeof window !== 'undefined';
    this.baseUrl = options.baseUrl || (isBrowser ? '/api/yahoo' : 'https://query1.finance.yahoo.com');
    this.fetchFn = options.fetchFn || fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs || 10000;
  }

  /**
   * Fetch a single quote for a symbol
   */
  async getQuote(symbol: string): Promise<MarketQuote> {
    const encoded = encodeURIComponent(symbol);
    const url = `${this.baseUrl}/v8/finance/chart/${encoded}?range=1d&interval=1d`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchFn(url, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const json = await response.json();
      const quote = parseYahooChartResponse(json, symbol, Date.now());
      this.lastSuccessfulQuotes.set(symbol, quote);
      return quote;
    } catch (err: any) {
      const errorMsg = err.name === 'AbortError' ? 'Request timed out after 10s' : (err.message || 'Network fetch failure');
      const prev = this.lastSuccessfulQuotes.get(symbol);
      if (prev) {
        return markQuoteAsPreservedStale(prev, errorMsg, Date.now());
      }
      throw new Error(`Failed to retrieve quote for ${symbol}: ${errorMsg}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Fetch quotes for all requested symbols with deduplication & stale fallback preservation
   */
  async getQuotes(symbols: string[] = SUPPORTED_INSTRUMENTS.map((i) => i.symbol)): Promise<MarketFetchResult> {
    // Prevent duplicate overlapping requests by reusing in-flight promise
    if (this.inFlightRequest) {
      return this.inFlightRequest;
    }

    this.inFlightRequest = this.executeFetchBatch(symbols).finally(() => {
      this.inFlightRequest = null;
    });

    return this.inFlightRequest;
  }

  private async executeFetchBatch(symbols: string[]): Promise<MarketFetchResult> {
    const quotes: MarketQuote[] = [];
    const errors: Record<string, string> = {};
    const fetchTimestamp = Date.now();
    const fetchTimeIST = formatISTTime(fetchTimestamp);

    const promises = symbols.map(async (symbol) => {
      try {
        const quote = await this.getQuote(symbol);
        quotes.push(quote);
        if (quote.isPreservedStaleOnFailure) {
          errors[symbol] = quote.staleReason;
        }
      } catch (err: any) {
        const msg = err.message || 'Fetch failed';
        errors[symbol] = msg;
        const prev = this.lastSuccessfulQuotes.get(symbol);
        if (prev) {
          quotes.push(markQuoteAsPreservedStale(prev, msg, fetchTimestamp));
        }
      }
    });

    await Promise.all(promises);

    // Sort according to defined display order
    quotes.sort((a, b) => {
      const orderA = SUPPORTED_INSTRUMENTS.find((i) => i.symbol === a.symbol)?.displayOrder ?? 99;
      const orderB = SUPPORTED_INSTRUMENTS.find((i) => i.symbol === b.symbol)?.displayOrder ?? 99;
      return orderA - orderB;
    });

    const allSucceeded = Object.keys(errors).length === 0;
    const isStale = quotes.some((q) => q.isDelayedOrStale);

    return {
      quotes,
      fetchTimeIST,
      fetchTimestamp,
      allSucceeded,
      errors,
      isStale,
      dataSource: YAHOO_PROVIDER_DISCLOSURES.name,
    };
  }

  /**
   * Returns whether a request is currently actively in flight
   */
  public isRequestInFlight(): boolean {
    return this.inFlightRequest !== null;
  }

  /**
   * Clear cached quotes (mainly for testing)
   */
  public clearCache(): void {
    this.lastSuccessfulQuotes.clear();
  }
}

// Singleton default export for the app
export const defaultMarketProvider = new YahooFinanceMarketProvider();
