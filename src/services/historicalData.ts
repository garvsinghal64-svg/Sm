/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { formatISTTime, SUPPORTED_INSTRUMENTS } from './marketDataProvider.ts';
import { isWeekendIST, getHolidayInfo, getSpecialSessionInfo } from '../utils/dateEngine.ts';
import { checkHolidayCoverage } from '../holidays.js';

export type HistoricalRange = '5d' | '1mo' | '3mo' | '6mo' | '1y' | '5y';
export type HistoricalInterval = '1d';

export type CandleStatus = 'VALID' | 'NULL_CLOSE' | 'NULL_OHLC' | 'INVALID_PRICE';
export type CandleFormationStatus = 'FORMING_INTRADAY' | 'COMPLETED_EOD' | 'INVALID_OR_MISSING';

export type CalendarDateStatus =
  | 'VERIFIED_TRADING_DAY'
  | 'CONFIRMED_EXCHANGE_HOLIDAY'
  | 'SPECIAL_SESSION'
  | 'WEEKEND'
  | 'CALENDAR_UNVERIFIED';

export type CalendarCoverageStatus = 'FULLY_VERIFIED' | 'PARTIALLY_UNVERIFIED' | 'CALENDAR_UNVERIFIED';

export interface HistoricalCandle {
  timestamp: number; // in milliseconds
  dateString: string; // YYYY-MM-DD in IST
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  adjClose: number | null;
  volume: number | null;
  isMissing: boolean;
  status: CandleStatus;
  calendarStatus: CalendarDateStatus;
}

export interface HistoricalCalendarAudit {
  calendarCoverageStatus: CalendarCoverageStatus;
  verifiedCalendarYears: number[];
  unverifiedCalendarYears: number[];
  confirmedHolidayDates: string[];
  specialSessionDates: string[];
  unverifiedCalendarDates: string[];
  missingSessionDates: string[];
}

export interface HistoricalSeries {
  symbol: string;
  name: string;
  exchange: 'NSE' | 'BSE';
  type: 'INDEX' | 'EQUITY';
  currency: string;
  range: HistoricalRange;
  interval: HistoricalInterval;
  candles: HistoricalCandle[];
  totalCandles: number;
  validCandles: number;
  missingCandles: number;
  nullCloseCandles: number;
  nullOhlcCandles: number;
  invalidPriceCandles: number;
  holidayOrSpecialNullCandles: number;
  unverifiedCalendarNullCandles: number;
  genuinelyMissingTradingCandles: number;
  malformedTimestamps: number;
  duplicateTimestampsRemoved: number;
  wasOutOfOrder: boolean;
  missingDates: string[];
  missingSessionDates: string[];
  confirmedHolidayDates: string[];
  specialSessionDates: string[];
  unverifiedCalendarDates: string[];
  verifiedCalendarYears: number[];
  unverifiedCalendarYears: number[];
  calendarCoverageStatus: CalendarCoverageStatus;
  periodStart: string;
  periodEnd: string;
  latestCandleTimestamp: number;
  latestCandleTimestampIST: string;
  latestCandleSessionDateIST: string;
  isLatestCandleComplete: boolean;
  isOfficialCloseVerified: boolean;
  latestCandleFormation: CandleFormationStatus;
  latestCandleFormationLabel: string;
  hasAdjCloseSeries: boolean;
  isSplitAdjustedOnChart: boolean;
  isDividendAdjustedOnChart: boolean;
  priceAdjustmentBasis: 'SPLIT_ADJUSTED_UNADJUSTED_DIVIDEND';
  priceAdjustmentDisclosure: string;
  fetchTimestamp: number;
  fetchTimestampIST: string;
  dataSource: string;
  freshnessStatus: 'LIVE_SESSION' | 'CLOSED_EOD';
}

/**
 * Format timestamp into YYYY-MM-DD (using IST timezone offset +05:30)
 */
export function formatISTDateOnly(timestampMs: number): string {
  if (typeof timestampMs !== 'number' || !Number.isFinite(timestampMs) || timestampMs <= 0) {
    return 'N/A';
  }
  // IST is UTC + 5h30m = 19800000 ms
  const istDate = new Date(timestampMs + 19800000);
  return istDate.toISOString().slice(0, 10);
}

/**
 * Classifies a calendar date (YYYY-MM-DD in IST) against the verified NSE/BSE exchange calendar.
 * - Never assumes the 2025-2026 holiday calendar applies to older years (2021-2024) or provisional years (2027+).
 * - If the date's year does not have verified complete holiday coverage in src/holidays.js,
 *   returns 'CALENDAR_UNVERIFIED'.
 * - Otherwise distinguishes 'SPECIAL_SESSION', 'CONFIRMED_EXCHANGE_HOLIDAY', 'WEEKEND', and 'VERIFIED_TRADING_DAY'.
 */
export function classifyExchangeCalendarDate(
  dateStr: string,
  exchange: 'NSE' | 'BSE' = 'NSE'
): CalendarDateStatus {
  if (!dateStr || dateStr === 'N/A' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return 'CALENDAR_UNVERIFIED';
  }

  const year = Number(dateStr.slice(0, 4));
  const coverage = checkHolidayCoverage(year, exchange);
  if (!coverage.isVerified || !coverage.isComplete) {
    return 'CALENDAR_UNVERIFIED';
  }

  const special = getSpecialSessionInfo(dateStr, exchange);
  if (special.isSpecialSession) {
    return 'SPECIAL_SESSION';
  }

  const holiday = getHolidayInfo(dateStr, exchange);
  if (holiday.isHoliday) {
    return 'CONFIRMED_EXCHANGE_HOLIDAY';
  }

  const weekend = isWeekendIST(dateStr);
  if (weekend.isWeekend) {
    return 'WEEKEND';
  }

  return 'VERIFIED_TRADING_DAY';
}

/**
 * Audits all calendar dates between startDateStr and endDateStr:
 * - Never marks a date as a missing trading session solely because it is a weekday.
 * - Weekdays in years without verified exchange-holiday coverage (e.g. 2021-2024 in 5y series)
 *   are classified as 'CALENDAR_UNVERIFIED' in unverifiedCalendarDates.
 * - Confirmed exchange holidays in verified years are recorded in confirmedHolidayDates.
 * - Special sessions (e.g. Diwali Muhurat, Union Budget Saturday) are recorded in specialSessionDates.
 * - Only verified regular trading days ('VERIFIED_TRADING_DAY') completely absent from presentDates
 *   are recorded in missingSessionDates.
 */
export function auditHistoricalSessionCalendar(
  startDateStr: string,
  endDateStr: string,
  presentDates: Set<string>,
  exchange: 'NSE' | 'BSE' = 'NSE'
): HistoricalCalendarAudit {
  if (
    !startDateStr ||
    !endDateStr ||
    startDateStr === 'N/A' ||
    endDateStr === 'N/A' ||
    startDateStr > endDateStr
  ) {
    return {
      calendarCoverageStatus: 'CALENDAR_UNVERIFIED',
      verifiedCalendarYears: [],
      unverifiedCalendarYears: [],
      confirmedHolidayDates: [],
      specialSessionDates: [],
      unverifiedCalendarDates: [],
      missingSessionDates: [],
    };
  }

  const startUtc = new Date(`${startDateStr}T00:00:00Z`).getTime();
  const endUtc = new Date(`${endDateStr}T00:00:00Z`).getTime();
  if (!Number.isFinite(startUtc) || !Number.isFinite(endUtc)) {
    return {
      calendarCoverageStatus: 'CALENDAR_UNVERIFIED',
      verifiedCalendarYears: [],
      unverifiedCalendarYears: [],
      confirmedHolidayDates: [],
      specialSessionDates: [],
      unverifiedCalendarDates: [],
      missingSessionDates: [],
    };
  }

  const verifiedYearsSet = new Set<number>();
  const unverifiedYearsSet = new Set<number>();
  const confirmedHolidayDates: string[] = [];
  const specialSessionDates: string[] = [];
  const unverifiedCalendarDates: string[] = [];
  const missingSessionDates: string[] = [];

  const dayMs = 86400 * 1000;
  for (let t = startUtc; t <= endUtc; t += dayMs) {
    const dStr = new Date(t).toISOString().slice(0, 10);
    const year = Number(dStr.slice(0, 4));
    const status = classifyExchangeCalendarDate(dStr, exchange);

    if (status === 'CALENDAR_UNVERIFIED') {
      unverifiedYearsSet.add(year);
      // Only record unobserved weekdays in unverifiedCalendarDates so weekends are not conflated
      if (!presentDates.has(dStr) && !isWeekendIST(dStr).isWeekend) {
        unverifiedCalendarDates.push(dStr);
      }
      continue;
    }

    verifiedYearsSet.add(year);

    if (status === 'SPECIAL_SESSION') {
      specialSessionDates.push(dStr);
    } else if (status === 'CONFIRMED_EXCHANGE_HOLIDAY') {
      confirmedHolidayDates.push(dStr);
    } else if (status === 'VERIFIED_TRADING_DAY') {
      // Strictly verified trading day: if absent from provider payload, it is a genuinely missing provider observation
      if (!presentDates.has(dStr)) {
        missingSessionDates.push(dStr);
      }
    }
  }

  const verifiedCalendarYears = Array.from(verifiedYearsSet).sort((a, b) => a - b);
  const unverifiedCalendarYears = Array.from(unverifiedYearsSet).sort((a, b) => a - b);

  let calendarCoverageStatus: CalendarCoverageStatus = 'FULLY_VERIFIED';
  if (unverifiedCalendarYears.length > 0 && verifiedCalendarYears.length > 0) {
    calendarCoverageStatus = 'PARTIALLY_UNVERIFIED';
  } else if (unverifiedCalendarYears.length > 0 && verifiedCalendarYears.length === 0) {
    calendarCoverageStatus = 'CALENDAR_UNVERIFIED';
  }

  return {
    calendarCoverageStatus,
    verifiedCalendarYears,
    unverifiedCalendarYears,
    confirmedHolidayDates,
    specialSessionDates,
    unverifiedCalendarDates,
    missingSessionDates,
  };
}

/**
 * Backwards-compatible wrapper returning only genuinely missing verified trading sessions.
 */
export function findMissingTradingSessions(
  startDateStr: string,
  endDateStr: string,
  presentDates: Set<string>,
  exchange: 'NSE' | 'BSE' = 'NSE'
): string[] {
  return auditHistoricalSessionCalendar(startDateStr, endDateStr, presentDates, exchange)
    .missingSessionDates;
}

/**
 * Extracts close prices for technical indicator calculations (SMA, RSI, MACD).
 * Strictly maps any missing or invalid candle (status !== 'VALID' or isMissing === true) to null
 * so invalid candles are never included as numeric prices and explicitly propagate missing state.
 */
export function extractIndicatorInputPrices(series: HistoricalSeries | null | undefined): (number | null)[] {
  if (!series || !Array.isArray(series.candles)) return [];
  return series.candles.map((c) => (c.isMissing || c.status !== 'VALID' ? null : c.close));
}

/**
 * Parse raw Yahoo Finance chart API response for historical series.
 * Strictly verifies each candle:
 * - Rejects malformed timestamps (null, NaN, <= 0, non-finite)
 * - Detects and sorts out-of-order timestamps and deduplicates repeated timestamps
 * - NEVER fabricates prices or replaces null Open/High/Low with Close
 * - NEVER silently replaces or interpolates missing candles
 * - Validates full OHLC envelope consistency (low <= open <= high, low <= close <= high, positive finite prices)
 * - Classifies each candle date against verified exchange calendars vs CALENDAR_UNVERIFIED
 * - Never labels a candle "Official Session Close" without independent exchange verification
 */
export function parseYahooHistoricalResponse(
  rawJson: any,
  symbol: string,
  range: HistoricalRange = '1y',
  fetchedAtMs: number = Date.now()
): HistoricalSeries {
  if (!rawJson || typeof rawJson !== 'object') {
    throw new Error(`Invalid JSON response received for historical data for ${symbol}`);
  }

  const result = rawJson.chart?.result?.[0];
  if (!result) {
    const errorMsg = rawJson.chart?.error?.description || 'No result data found in response';
    throw new Error(`Historical data error for ${symbol}: ${errorMsg}`);
  }

  const meta = result.meta || {};
  const config = SUPPORTED_INSTRUMENTS.find((i) => i.symbol === symbol);
  const name = config?.name || meta.shortName || meta.longName || symbol;
  const exchange = config?.exchange || (meta.exchangeName === 'BSE' ? 'BSE' : 'NSE');
  const type = config?.type || (meta.instrumentType === 'INDEX' ? 'INDEX' : 'EQUITY');
  const currency = meta.currency || 'INR';

  const rawTimestamps: any[] = Array.isArray(result.timestamp) ? result.timestamp : [];
  const quoteIndicators = result.indicators?.quote?.[0] || {};
  const opens = quoteIndicators.open || [];
  const highs = quoteIndicators.high || [];
  const lows = quoteIndicators.low || [];
  const closes = quoteIndicators.close || [];
  const volumes = quoteIndicators.volume || [];
  const adjCloses = result.indicators?.adjclose?.[0]?.adjclose || [];
  const hasAdjCloseSeries = Array.isArray(adjCloses) && adjCloses.length > 0;

  const candles: HistoricalCandle[] = [];
  const missingDates: string[] = [];
  let validCandles = 0;
  let nullCloseCandles = 0;
  let nullOhlcCandles = 0;
  let invalidPriceCandles = 0;
  let holidayOrSpecialNullCandles = 0;
  let unverifiedCalendarNullCandles = 0;
  let genuinelyMissingTradingCandles = 0;
  let malformedTimestamps = 0;

  interface RawCandleItem {
    tSec: number;
    o: any;
    h: any;
    l: any;
    c: any;
    adjC: any;
    v: any;
  }

  const rawItems: RawCandleItem[] = [];
  for (let i = 0; i < rawTimestamps.length; i++) {
    const tSec = rawTimestamps[i];
    if (typeof tSec !== 'number' || !Number.isFinite(tSec) || tSec <= 0) {
      malformedTimestamps++;
      continue;
    }
    rawItems.push({
      tSec,
      o: opens[i],
      h: highs[i],
      l: lows[i],
      c: closes[i],
      adjC: adjCloses[i],
      v: volumes[i],
    });
  }

  // Check if timestamps were out of order before sorting
  let wasOutOfOrder = false;
  for (let i = 1; i < rawItems.length; i++) {
    if (rawItems[i].tSec < rawItems[i - 1].tSec) {
      wasOutOfOrder = true;
      break;
    }
  }

  // Sort ascending by timestamp
  rawItems.sort((a, b) => a.tSec - b.tSec);

  // Deduplicate repeated timestamps
  const seenTimestamps = new Set<number>();
  const uniqueItems: RawCandleItem[] = [];
  let duplicateTimestampsRemoved = 0;
  for (const item of rawItems) {
    if (!seenTimestamps.has(item.tSec)) {
      seenTimestamps.add(item.tSec);
      uniqueItems.push(item);
    } else {
      duplicateTimestampsRemoved++;
    }
  }

  const presentDateSet = new Set<string>();

  for (let i = 0; i < uniqueItems.length; i++) {
    const item = uniqueItems[i];
    const tMs = item.tSec * 1000;
    const dateStr = formatISTDateOnly(tMs);

    const calendarStatus = classifyExchangeCalendarDate(dateStr, exchange);

    const c = item.c;
    const o = item.o;
    const h = item.h;
    const l = item.l;
    const adjC = item.adjC;
    const v = item.v;

    const classifyMissingCandleContext = (calStat: CalendarDateStatus) => {
      if (calStat === 'CONFIRMED_EXCHANGE_HOLIDAY' || calStat === 'SPECIAL_SESSION') {
        holidayOrSpecialNullCandles++;
      } else if (calStat === 'CALENDAR_UNVERIFIED') {
        unverifiedCalendarNullCandles++;
      } else {
        genuinelyMissingTradingCandles++;
      }
    };

    // 1. Genuinely null close candle in provider response
    if (c === null || c === undefined) {
      nullCloseCandles++;
      classifyMissingCandleContext(calendarStatus);
      candles.push({
        timestamp: tMs,
        dateString: dateStr,
        open: null,
        high: null,
        low: null,
        close: null,
        adjClose: null,
        volume: null,
        isMissing: true,
        status: 'NULL_CLOSE',
        calendarStatus,
      });
      missingDates.push(dateStr);
      continue;
    }

    // 2. Partial null OHLC (close is non-null, but open, high, or low is null/undefined)
    // Never fabricate open/high/low from close!
    if (o === null || o === undefined || h === null || h === undefined || l === null || l === undefined) {
      nullOhlcCandles++;
      classifyMissingCandleContext(calendarStatus);
      candles.push({
        timestamp: tMs,
        dateString: dateStr,
        open: null,
        high: null,
        low: null,
        close: null,
        adjClose: null,
        volume: null,
        isMissing: true,
        status: 'NULL_OHLC',
        calendarStatus,
      });
      missingDates.push(dateStr);
      continue;
    }

    // 3. Validate numeric finiteness, positivity, and OHLC envelope consistency
    const isValidNumbers =
      typeof o === 'number' &&
      Number.isFinite(o) &&
      o > 0 &&
      typeof h === 'number' &&
      Number.isFinite(h) &&
      h > 0 &&
      typeof l === 'number' &&
      Number.isFinite(l) &&
      l > 0 &&
      typeof c === 'number' &&
      Number.isFinite(c) &&
      c > 0;

    // Tolerance 1e-4 for floating-point rounding in provider feeds while enforcing high >= low and open/close within [low, high]
    const eps = 1e-4;
    const isValidEnvelope =
      isValidNumbers &&
      h + eps >= l &&
      o >= l - eps &&
      o <= h + eps &&
      c >= l - eps &&
      c <= h + eps;

    const isInvalidVolume =
      v !== null && v !== undefined && (typeof v !== 'number' || !Number.isFinite(v) || v < 0);

    const roundedO = isValidNumbers ? Number(o.toFixed(2)) : 0;
    const roundedH = isValidNumbers ? Number(h.toFixed(2)) : 0;
    const roundedL = isValidNumbers ? Number(l.toFixed(2)) : 0;
    const roundedC = isValidNumbers ? Number(c.toFixed(2)) : 0;
    const validVolume = typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
    const isZeroVolumeFlatEquityPlaceholder =
      isValidNumbers &&
      type === 'EQUITY' &&
      validVolume === 0 &&
      roundedO === roundedH &&
      roundedH === roundedL &&
      roundedL === roundedC;
    const isConfirmedHolidayBar = calendarStatus === 'CONFIRMED_EXCHANGE_HOLIDAY';

    if (
      !isValidEnvelope ||
      isInvalidVolume ||
      isZeroVolumeFlatEquityPlaceholder ||
      isConfirmedHolidayBar
    ) {
      invalidPriceCandles++;
      classifyMissingCandleContext(calendarStatus);
      candles.push({
        timestamp: tMs,
        dateString: dateStr,
        open: null,
        high: null,
        low: null,
        close: null,
        adjClose: null,
        volume: null,
        isMissing: true,
        status: 'INVALID_PRICE',
        calendarStatus,
      });
      missingDates.push(dateStr);
      continue;
    }

    // 4. Valid observation
    validCandles++;
    if (dateStr !== 'N/A') {
      presentDateSet.add(dateStr);
    }

    const validAdjClose =
      typeof adjC === 'number' && Number.isFinite(adjC) && adjC > 0 ? Number(adjC.toFixed(2)) : null;

    candles.push({
      timestamp: tMs,
      dateString: dateStr,
      open: roundedO,
      high: roundedH,
      low: roundedL,
      close: roundedC,
      adjClose: validAdjClose,
      volume: validVolume,
      isMissing: false,
      status: 'VALID',
      calendarStatus,
    });
  }

  const totalCandles = candles.length;
  const missingCandles = totalCandles - validCandles;

  const firstCandleDate = candles.length > 0 ? candles[0].dateString : 'N/A';
  const lastCandleDate = candles.length > 0 ? candles[candles.length - 1].dateString : 'N/A';

  // Audit session calendar across [firstCandleDate..lastCandleDate]
  const calendarAudit = auditHistoricalSessionCalendar(
    firstCandleDate,
    lastCandleDate,
    presentDateSet,
    exchange
  );

  // Latest candle metadata & strict close-labeling verification
  const latestCandle = candles.length > 0 ? candles[candles.length - 1] : null;
  const latestCandleTimestamp = latestCandle ? latestCandle.timestamp : 0;
  const latestCandleTimestampIST = formatISTTime(latestCandleTimestamp);
  const latestCandleSessionDateIST = latestCandle ? latestCandle.dateString : 'N/A';
  const fetchTimestampIST = formatISTTime(fetchedAtMs);
  const fetchDateIST = formatISTDateOnly(fetchedAtMs);

  const tradingPeriodRegular = meta.currentTradingPeriod?.regular;
  const nowSec = Math.floor(fetchedAtMs / 1000);

  let isIntradayForming = false;
  if (
    tradingPeriodRegular &&
    typeof tradingPeriodRegular.start === 'number' &&
    typeof tradingPeriodRegular.end === 'number'
  ) {
    if (nowSec >= tradingPeriodRegular.start && nowSec < tradingPeriodRegular.end) {
      isIntradayForming = true;
    }
  } else if (latestCandle && latestCandleSessionDateIST === fetchDateIST) {
    const istMs = fetchedAtMs + 19800000;
    const istDateObj = new Date(istMs);
    const secOfDay =
      istDateObj.getUTCHours() * 3600 +
      istDateObj.getUTCMinutes() * 60 +
      istDateObj.getUTCSeconds();
    if (secOfDay >= 9 * 3600 + 15 * 60 && secOfDay < 15 * 3600 + 30 * 60) {
      isIntradayForming = true;
    }
  }

  const freshnessStatus: 'LIVE_SESSION' | 'CLOSED_EOD' = isIntradayForming
    ? 'LIVE_SESSION'
    : 'CLOSED_EOD';

  // Official exchange close status CANNOT be verified from Yahoo Finance v8 timestamps alone
  const isOfficialCloseVerified = false;
  let isLatestCandleComplete = false;
  let latestCandleFormation: CandleFormationStatus = 'INVALID_OR_MISSING';
  let latestCandleFormationLabel = 'Latest available daily candle — official close unverified.';

  if (!latestCandle || latestCandle.status !== 'VALID') {
    isLatestCandleComplete = false;
    latestCandleFormation = 'INVALID_OR_MISSING';
    latestCandleFormationLabel = 'Latest daily candle invalid or missing — official close unverified.';
  } else if (isIntradayForming) {
    isLatestCandleComplete = false;
    latestCandleFormation = 'FORMING_INTRADAY';
    latestCandleFormationLabel = 'Forming intraday candle — official close unverified.';
  } else {
    isLatestCandleComplete = true;
    latestCandleFormation = 'COMPLETED_EOD';
    latestCandleFormationLabel = 'Latest available daily candle — official close unverified.';
  }

  return {
    symbol,
    name,
    exchange,
    type,
    currency,
    range,
    interval: '1d',
    candles,
    totalCandles,
    validCandles,
    missingCandles,
    nullCloseCandles,
    nullOhlcCandles,
    invalidPriceCandles,
    holidayOrSpecialNullCandles,
    unverifiedCalendarNullCandles,
    genuinelyMissingTradingCandles,
    malformedTimestamps,
    duplicateTimestampsRemoved,
    wasOutOfOrder,
    missingDates,
    missingSessionDates: calendarAudit.missingSessionDates,
    confirmedHolidayDates: calendarAudit.confirmedHolidayDates,
    specialSessionDates: calendarAudit.specialSessionDates,
    unverifiedCalendarDates: calendarAudit.unverifiedCalendarDates,
    verifiedCalendarYears: calendarAudit.verifiedCalendarYears,
    unverifiedCalendarYears: calendarAudit.unverifiedCalendarYears,
    calendarCoverageStatus: calendarAudit.calendarCoverageStatus,
    periodStart: firstCandleDate,
    periodEnd: lastCandleDate,
    latestCandleTimestamp,
    latestCandleTimestampIST,
    latestCandleSessionDateIST,
    isLatestCandleComplete,
    isOfficialCloseVerified,
    latestCandleFormation,
    latestCandleFormationLabel,
    hasAdjCloseSeries,
    isSplitAdjustedOnChart: true,
    isDividendAdjustedOnChart: false,
    priceAdjustmentBasis: 'SPLIT_ADJUSTED_UNADJUSTED_DIVIDEND',
    priceAdjustmentDisclosure:
      'Chart OHLC & indicator prices use Yahoo Finance indicators.quote[0] (split/bonus-adjusted, UNADJUSTED for cash dividends). Separate dividend-and-split adjusted close (indicators.adjclose[0]) is preserved in adjClose when supplied.',
    fetchTimestamp: fetchedAtMs,
    fetchTimestampIST,
    dataSource: 'Yahoo Finance (v8 Chart API)',
    freshnessStatus,
  };
}

/**
 * Historical Data Provider Client
 */
export class HistoricalDataProvider {
  private baseUrl: string;
  private fetchFn: typeof fetch;
  private timeoutMs: number;
  private cache: Map<string, { data: HistoricalSeries; timestamp: number }> = new Map();

  constructor(options: { baseUrl?: string; fetchFn?: typeof fetch; timeoutMs?: number } = {}) {
    const isBrowser = typeof window !== 'undefined';
    this.baseUrl = options.baseUrl || (isBrowser ? '/api/yahoo' : 'https://query1.finance.yahoo.com');
    this.fetchFn = options.fetchFn || fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs || 15000;
  }

  async getHistoricalData(
    symbol: string,
    range: HistoricalRange = '1y',
    forceRefresh = false
  ): Promise<HistoricalSeries> {
    const cacheKey = `${symbol}_${range}`;
    const cached = this.cache.get(cacheKey);
    if (!forceRefresh && cached && Date.now() - cached.timestamp < 60000) {
      return cached.data;
    }

    const encoded = encodeURIComponent(symbol);
    const url = `${this.baseUrl}/v8/finance/chart/${encoded}?range=${range}&interval=1d`;

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
      const series = parseYahooHistoricalResponse(json, symbol, range, Date.now());
      this.cache.set(cacheKey, { data: series, timestamp: Date.now() });
      return series;
    } catch (err: any) {
      const errorMsg =
        err.name === 'AbortError' ? 'Historical request timed out after 15s' : err.message || 'Network fetch failure';
      throw new Error(`Failed to retrieve historical data for ${symbol} (${range}): ${errorMsg}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  clearCache(): void {
    this.cache.clear();
  }
}

export const defaultHistoricalProvider = new HistoricalDataProvider();
export { SUPPORTED_INSTRUMENTS };
