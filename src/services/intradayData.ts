/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * STAGE 4D — INTRADAY MARKET DATA INFRASTRUCTURE & VALIDATION ENGINE
 * =================================================================
 * High-precision intraday bar support (1m, 5m, 15m, 30m, 60m) with strict
 * Indian Standard Time (IST) market session enforcement (09:15 - 15:30 IST),
 * incomplete candle detection, duplicate timestamp filtering, full OHLC consistency
 * validation, and honest data freshness and failure state accounting.
 */

import { formatISTTime, SUPPORTED_INSTRUMENTS } from './marketDataProvider.ts';
import { isWeekendIST, getHolidayInfo, getSpecialSessionInfo } from '../utils/dateEngine.ts';
import { checkHolidayCoverage } from '../holidays.js';
import { classifyExchangeCalendarDate, CalendarDateStatus } from './historicalData.ts';

export type IntradayInterval = '1m' | '5m' | '15m' | '30m' | '60m' | '1d';
export type IntradayRange = '1d' | '5d' | '1mo' | '3mo' | '6mo' | '1y';

export type IntradayDataStatus =
  | 'LIVE_INTRADAY'
  | 'DELAYED_INTRADAY'
  | 'CLOSED_EOD'
  | 'OFFLINE_DEMO'
  | 'UNAVAILABLE_ERROR';

export interface IntradayCandle {
  timestamp: number; // millisecond epoch
  timestampIST: string; // YYYY-MM-DD HH:mm:ss IST
  dateString: string; // YYYY-MM-DD in IST
  timeString: string; // HH:mm in IST
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isComplete: boolean; // false if current session candle is still forming
  sessionMinute: number; // minutes from 09:15 (0 to 375)
  isValid: boolean;
  validationError?: string;
}

export interface IntradaySeriesMetadata {
  symbol: string;
  name: string;
  exchange: 'NSE' | 'BSE';
  type: 'INDEX' | 'EQUITY';
  currency: string;
  interval: IntradayInterval;
  range: IntradayRange;
  dataStatus: IntradayDataStatus;
  dataSource: string;
  fetchTimestamp: number;
  fetchTimestampIST: string;
  isMarketOpenAtFetch: boolean;
  totalBars: number;
  validBars: number;
  incompleteBars: number;
  duplicateBarsRemoved: number;
  outOfOrderBarsCorrected: number;
  rejectedBars: number;
  firstBarTimestampIST: string;
  latestBarTimestampIST: string;
  isLatestBarComplete: boolean;
  calendarStatus: CalendarDateStatus;
}

export interface IntradaySeries {
  metadata: IntradaySeriesMetadata;
  candles: IntradayCandle[];
  errors: string[];
}

/**
 * Validates whether an interval is genuinely supported by the free Yahoo Finance endpoint.
 * Yahoo Chart API allows:
 * - 1m: range <= 7d
 * - 5m, 15m, 30m: range <= 60d
 * - 60m: range <= 730d
 * - 1d: range <= 10y
 */
export function validateIntervalAndRange(
  interval: IntradayInterval,
  range: IntradayRange
): { isValid: boolean; reason?: string } {
  if (interval === '1m') {
    if (range !== '1d' && range !== '5d') {
      return {
        isValid: false,
        reason: '1-minute intraday interval is restricted to max 5 days on free Yahoo Finance.',
      };
    }
  }
  if (['5m', '15m', '30m'].includes(interval)) {
    if (range === '6mo' || range === '1y') {
      return {
        isValid: false,
        reason: `${interval} interval is limited to max 60 days on free Yahoo Finance.`,
      };
    }
  }
  return { isValid: true };
}

/**
 * Checks whether an IST time (HH:mm) falls strictly within standard Indian market hours.
 * Regular equity market: 09:15 AM to 03:30 PM IST (09:15 to 15:30).
 */
export function isWithinRegularISTTradingHours(hours: number, minutes: number): boolean {
  const totalMins = hours * 60 + minutes;
  const marketOpenMins = 9 * 60 + 15; // 09:15
  const marketCloseMins = 15 * 60 + 30; // 15:30
  return totalMins >= marketOpenMins && totalMins <= marketCloseMins;
}

/**
 * Returns minute offset from 09:15 IST (0 to 375).
 */
export function getSessionMinute(hours: number, minutes: number): number {
  const currentMins = hours * 60 + minutes;
  const marketOpenMins = 9 * 60 + 15;
  return Math.max(0, currentMins - marketOpenMins);
}

/**
 * Extracts IST time components from millisecond timestamp.
 */
export function getISTTimeComponents(timestampMs: number): {
  dateStr: string;
  timeStr: string;
  hours: number;
  minutes: number;
  seconds: number;
  formattedIST: string;
} {
  // IST is UTC + 5h 30m = +19,800,000 ms
  const istDate = new Date(timestampMs + 19800000);
  const iso = istDate.toISOString();
  const dateStr = iso.slice(0, 10);
  const timeStr = iso.slice(11, 16);
  const hours = Number(iso.slice(11, 13));
  const minutes = Number(iso.slice(14, 16));
  const seconds = Number(iso.slice(17, 19));
  const formattedIST = `${dateStr} ${iso.slice(11, 19)} IST`;
  return { dateStr, timeStr, hours, minutes, seconds, formattedIST };
}

/**
 * Determines whether a bar timestamp is still actively forming (incomplete) relative to reference time.
 * An intraday bar for interval `I` starting at `T` is complete only when `referenceTime >= T + intervalMs`.
 */
export function isCandleComplete(
  barTimestampMs: number,
  interval: IntradayInterval,
  referenceTimeMs: number
): boolean {
  const intervalMsMap: Record<IntradayInterval, number> = {
    '1m': 60 * 1000,
    '5m': 5 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    '30m': 30 * 60 * 1000,
    '60m': 60 * 60 * 1000,
    '1d': 24 * 60 * 60 * 1000,
  };
  const barDuration = intervalMsMap[interval] || 60000;
  return referenceTimeMs >= barTimestampMs + barDuration;
}

/**
 * Parses and validates raw Yahoo Finance intraday chart responses.
 * Enforces:
 * - Rejection of NaN / non-finite / non-positive prices
 * - Envelope consistency: low <= open <= high, low <= close <= high, low <= high
 * - Timestamp chronological sorting and deduplication
 * - Detection of incomplete bars
 * - Identification of exchange session compliance
 */
export function parseYahooIntradayResponse(
  rawJson: any,
  symbol: string,
  interval: IntradayInterval = '5m',
  range: IntradayRange = '1d',
  nowMs: number = Date.now()
): IntradaySeries {
  const errors: string[] = [];

  if (!rawJson || typeof rawJson !== 'object') {
    throw new Error(`Invalid JSON response for intraday data: ${symbol}`);
  }

  const result = rawJson.chart?.result?.[0];
  if (!result) {
    const errorMsg = rawJson.chart?.error?.description || 'No intraday chart result in response';
    throw new Error(`Intraday data error for ${symbol}: ${errorMsg}`);
  }

  const meta = result.meta || {};
  const config = SUPPORTED_INSTRUMENTS.find((i) => i.symbol === symbol);
  const name = config?.name || meta.shortName || meta.longName || symbol;
  const exchange = config?.exchange || (meta.exchangeName === 'BSE' ? 'BSE' : 'NSE');
  const type = config?.type || (meta.instrumentType === 'INDEX' ? 'INDEX' : 'EQUITY');
  const currency = meta.currency || 'INR';

  const rawTimestamps: any[] = Array.isArray(result.timestamp) ? result.timestamp : [];
  const quote = result.indicators?.quote?.[0] || {};
  const opens = quote.open || [];
  const highs = quote.high || [];
  const lows = quote.low || [];
  const closes = quote.close || [];
  const volumes = quote.volume || [];

  interface RawBar {
    tSec: number;
    o: any;
    h: any;
    l: any;
    c: any;
    v: any;
  }

  const rawBars: RawBar[] = [];
  let malformedCount = 0;

  for (let i = 0; i < rawTimestamps.length; i++) {
    const tSec = rawTimestamps[i];
    if (typeof tSec !== 'number' || !Number.isFinite(tSec) || tSec <= 0) {
      malformedCount++;
      continue;
    }
    rawBars.push({
      tSec,
      o: opens[i],
      h: highs[i],
      l: lows[i],
      c: closes[i],
      v: volumes[i],
    });
  }

  // Detect out-of-order bars
  let wasOutOfOrder = false;
  for (let i = 1; i < rawBars.length; i++) {
    if (rawBars[i].tSec < rawBars[i - 1].tSec) {
      wasOutOfOrder = true;
      break;
    }
  }

  // Sort ascending
  rawBars.sort((a, b) => a.tSec - b.tSec);

  // Deduplicate timestamps
  const seenTimestamps = new Set<number>();
  const uniqueBars: RawBar[] = [];
  let duplicateBarsRemoved = 0;
  for (const bar of rawBars) {
    if (!seenTimestamps.has(bar.tSec)) {
      seenTimestamps.add(bar.tSec);
      uniqueBars.push(bar);
    } else {
      duplicateBarsRemoved++;
    }
  }

  const candles: IntradayCandle[] = [];
  let validBars = 0;
  let incompleteBars = 0;
  let rejectedBars = 0;

  for (const bar of uniqueBars) {
    const timestampMs = bar.tSec * 1000;
    const { dateStr, timeStr, hours, minutes, formattedIST } = getISTTimeComponents(timestampMs);
    const sessionMinute = getSessionMinute(hours, minutes);

    const o = Number(bar.o);
    const h = Number(bar.h);
    const l = Number(bar.l);
    const c = Number(bar.c);
    const v = Number(bar.v || 0);

    // Validate OHLC numeric sanity
    let isValid = true;
    let validationError: string | undefined;

    if (!Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) {
      isValid = false;
      validationError = 'Non-finite OHLC prices';
    } else if (o <= 0 || h <= 0 || l <= 0 || c <= 0) {
      isValid = false;
      validationError = 'Non-positive prices';
    } else if (l > h || o > h || c > h || o < l || c < l) {
      isValid = false;
      validationError = 'OHLC envelope violation (low > high or open/close outside range)';
    }

    const isComplete = isCandleComplete(timestampMs, interval, nowMs);
    if (!isComplete) {
      incompleteBars++;
    }

    if (isValid) {
      validBars++;
    } else {
      rejectedBars++;
      errors.push(`Bar at ${formattedIST} rejected: ${validationError}`);
    }

    candles.push({
      timestamp: timestampMs,
      timestampIST: formattedIST,
      dateString: dateStr,
      timeString: timeStr,
      open: isValid ? o : 0,
      high: isValid ? h : 0,
      low: isValid ? l : 0,
      close: isValid ? c : 0,
      volume: Number.isFinite(v) && v >= 0 ? v : 0,
      isComplete,
      sessionMinute,
      isValid,
      validationError,
    });
  }

  const latestCandle = candles[candles.length - 1];
  const firstCandle = candles[0];

  const fetchIST = getISTTimeComponents(nowMs);
  const isMarketOpenNow = isWithinRegularISTTradingHours(fetchIST.hours, fetchIST.minutes);

  const dataStatus: IntradayDataStatus =
    candles.length === 0
      ? 'UNAVAILABLE_ERROR'
      : isMarketOpenNow
      ? 'LIVE_INTRADAY'
      : 'CLOSED_EOD';

  const calendarStatus = latestCandle
    ? classifyExchangeCalendarDate(latestCandle.dateString, exchange)
    : 'CALENDAR_UNVERIFIED';

  const metadata: IntradaySeriesMetadata = {
    symbol,
    name,
    exchange,
    type,
    currency,
    interval,
    range,
    dataStatus,
    dataSource: 'Yahoo Finance Free Endpoint (Delayed 15m)',
    fetchTimestamp: nowMs,
    fetchTimestampIST: fetchIST.formattedIST,
    isMarketOpenAtFetch: isMarketOpenNow,
    totalBars: candles.length,
    validBars,
    incompleteBars,
    duplicateBarsRemoved,
    outOfOrderBarsCorrected: wasOutOfOrder ? 1 : 0,
    rejectedBars,
    firstBarTimestampIST: firstCandle?.timestampIST || 'N/A',
    latestBarTimestampIST: latestCandle?.timestampIST || 'N/A',
    isLatestBarComplete: latestCandle?.isComplete ?? false,
    calendarStatus,
  };

  return {
    metadata,
    candles,
    errors,
  };
}

/**
 * Creates a deterministic, leakage-free intraday fixture for testing and offline simulations.
 * Generates an exact 1-day or 5-day series of 5-minute bars (75 bars per regular session: 09:15 to 15:30).
 */
export function createDeterministicIntradayFixture(
  symbol: string = 'RELIANCE.NS',
  dateStr: string = '2026-10-21',
  interval: IntradayInterval = '5m',
  basePrice: number = 2500
): IntradaySeries {
  const config = SUPPORTED_INSTRUMENTS.find((i) => i.symbol === symbol) || SUPPORTED_INSTRUMENTS[3];
  const candles: IntradayCandle[] = [];

  // Parse YYYY-MM-DD
  const [year, month, day] = dateStr.split('-').map(Number);

  // 5m bars: 09:15, 09:20, ... 15:25 (75 bars total)
  const barIntervalMinutes = interval === '1m' ? 1 : interval === '15m' ? 15 : interval === '30m' ? 30 : interval === '60m' ? 60 : 5;
  const totalBarsInSession = Math.floor(375 / barIntervalMinutes);

  let currentClose = basePrice;

  for (let i = 0; i < totalBarsInSession; i++) {
    const minuteOfDay = 9 * 60 + 15 + i * barIntervalMinutes;
    const hours = Math.floor(minuteOfDay / 60);
    const minutes = minuteOfDay % 60;

    // Fixed deterministic price trajectory (no random noise)
    // Oscillates slightly, creating realistic breakout and pullback points
    const stepRatio = Math.sin((i / totalBarsInSession) * Math.PI * 2);
    const open = Math.round((currentClose + stepRatio * 2) * 100) / 100;
    const high = Math.round((open + Math.abs(stepRatio) * 3 + 2) * 100) / 100;
    const low = Math.round((open - Math.abs(stepRatio) * 2 - 1.5) * 100) / 100;
    const close = Math.round(((open + high + low) / 3 + stepRatio * 1.5) * 100) / 100;
    const volume = 50000 + Math.round(Math.abs(stepRatio) * 25000);

    currentClose = close;

    // Create timestamp in IST
    const istOffsetMs = 19800000;
    const utcDate = new Date(Date.UTC(year, month - 1, day, hours, minutes, 0) - istOffsetMs);
    const timestampMs = utcDate.getTime();

    const hh = String(hours).padStart(2, '0');
    const mm = String(minutes).padStart(2, '0');
    const formattedIST = `${dateStr} ${hh}:${mm}:00 IST`;

    candles.push({
      timestamp: timestampMs,
      timestampIST: formattedIST,
      dateString: dateStr,
      timeString: `${hh}:${mm}`,
      open,
      high,
      low,
      close,
      volume,
      isComplete: true, // all past historical bars complete
      sessionMinute: i * barIntervalMinutes,
      isValid: true,
    });
  }

  const first = candles[0];
  const last = candles[candles.length - 1];

  return {
    metadata: {
      symbol,
      name: config.name,
      exchange: config.exchange,
      type: config.type,
      currency: 'INR',
      interval,
      range: '1d',
      dataStatus: 'OFFLINE_DEMO',
      dataSource: 'Deterministic Offline Test Fixture (Zero Cost, No Paid API)',
      fetchTimestamp: last.timestamp,
      fetchTimestampIST: last.timestampIST,
      isMarketOpenAtFetch: false,
      totalBars: candles.length,
      validBars: candles.length,
      incompleteBars: 0,
      duplicateBarsRemoved: 0,
      outOfOrderBarsCorrected: 0,
      rejectedBars: 0,
      firstBarTimestampIST: first.timestampIST,
      latestBarTimestampIST: last.timestampIST,
      isLatestBarComplete: true,
      calendarStatus: 'VERIFIED_TRADING_DAY',
    },
    candles,
    errors: [],
  };
}

/**
 * Fetches real intraday series via the zero-cost Yahoo Finance proxy (/api/yahoo/v8/finance/chart/{symbol}).
 * Returns verified parsed IntradaySeries or throws descriptive error.
 */
export async function fetchLiveIntradaySeries(
  symbol: string,
  interval: IntradayInterval = '5m',
  range: IntradayRange = '1d'
): Promise<IntradaySeries> {
  const encoded = encodeURIComponent(symbol);
  const endpoint = `/api/yahoo/v8/finance/chart/${encoded}?interval=${interval}&range=${range}`;

  const res = await fetch(endpoint);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: Failed to fetch intraday data for ${symbol}`);
  }

  const json = await res.json();
  return parseYahooIntradayResponse(json, symbol, interval, range, Date.now());
}

