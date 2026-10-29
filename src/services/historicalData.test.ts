/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseYahooHistoricalResponse,
  formatISTDateOnly,
  findMissingTradingSessions,
  classifyExchangeCalendarDate,
  auditHistoricalSessionCalendar,
  extractIndicatorInputPrices,
} from './historicalData.ts';
import { calculateSMA, calculateRSI, calculateMACD } from '../utils/indicators.ts';

test('[HISTORICAL-DATA] parseYahooHistoricalResponse correctly parses valid candle series and adjustment metadata', () => {
  const mockPayload = {
    chart: {
      result: [
        {
          meta: {
            symbol: 'RELIANCE.NS',
            shortName: 'Reliance Industries',
            exchangeName: 'NSE',
            instrumentType: 'EQUITY',
            currency: 'INR',
            regularMarketTime: 1729399200,
          },
          timestamp: [1729053000, 1729139400, 1729225800], // Wed Oct 16, Thu Oct 17, Fri Oct 18, 2024
          indicators: {
            quote: [
              {
                open: [2480.5, 2485.0, 2490.0],
                high: [2492.0, 2496.0, 2501.0],
                low: [2475.0, 2482.0, 2488.0],
                close: [2487.0, 2491.5, 2498.5],
                volume: [15000000, 16000000, 14500000],
              },
            ],
            adjclose: [
              {
                adjclose: [2478.12, 2482.6, 2498.5],
              },
            ],
          },
        },
      ],
    },
  };

  const series = parseYahooHistoricalResponse(mockPayload, 'RELIANCE.NS', '1mo', 1729399500000);

  assert.equal(series.symbol, 'RELIANCE.NS');
  assert.equal(series.totalCandles, 3);
  assert.equal(series.validCandles, 3);
  assert.equal(series.missingCandles, 0);
  assert.equal(series.candles[0].close, 2487.0);
  assert.equal(series.candles[0].adjClose, 2478.12);
  assert.equal(series.candles[0].isMissing, false);
  assert.equal(series.hasAdjCloseSeries, true);
  assert.equal(series.isSplitAdjustedOnChart, true);
  assert.equal(series.isDividendAdjustedOnChart, false);
  assert.equal(series.priceAdjustmentBasis, 'SPLIT_ADJUSTED_UNADJUSTED_DIVIDEND');
  assert.match(series.priceAdjustmentDisclosure, /UNADJUSTED for cash dividends/);
});

test('[HISTORICAL-DATA] Market-close labeling: NEVER claims Official Session Close, labels completed candle unverified', () => {
  const sessionPayload = {
    chart: {
      result: [
        {
          meta: {
            symbol: '^NSEI',
            currentTradingPeriod: {
              regular: {
                start: 1729136700, // 09:15 IST
                end: 1729159200,   // 15:30 IST
              },
            },
          },
          timestamp: [1729139400],
          indicators: {
            quote: [
              {
                open: [24800],
                high: [24850],
                low: [24750],
                close: [24820],
                volume: [100000],
              },
            ],
          },
        },
      ],
    },
  };

  // 1. During active session (11:30 IST = 1729144800s)
  const activeSeries = parseYahooHistoricalResponse(sessionPayload, '^NSEI', '1mo', 1729144800 * 1000);
  assert.equal(activeSeries.isLatestCandleComplete, false);
  assert.equal(activeSeries.isOfficialCloseVerified, false);
  assert.equal(activeSeries.latestCandleFormation, 'FORMING_INTRADAY');
  assert.equal(
    activeSeries.latestCandleFormationLabel,
    'Forming intraday candle — official close unverified.'
  );

  // 2. After session close (16:30 IST = 1729162800s) or on a non-trading day
  const closedSeries = parseYahooHistoricalResponse(sessionPayload, '^NSEI', '1mo', 1729162800 * 1000);
  assert.equal(closedSeries.isLatestCandleComplete, true);
  assert.equal(closedSeries.isOfficialCloseVerified, false);
  assert.equal(closedSeries.latestCandleFormation, 'COMPLETED_EOD');
  assert.equal(
    closedSeries.latestCandleFormationLabel,
    'Latest available daily candle — official close unverified.'
  );
  assert.ok(
    !closedSeries.latestCandleFormationLabel.includes('Official Session Close'),
    'Must never label a Yahoo candle Official Session Close'
  );
});

test('[HISTORICAL-DATA] Market-close labeling: flags invalid or null latest candle as incomplete and unverified', () => {
  const nullLatestPayload = {
    chart: {
      result: [
        {
          meta: { symbol: '^NSEI' },
          timestamp: [1729139400, 1729225800],
          indicators: {
            quote: [
              {
                open: [24800, null],
                high: [24850, null],
                low: [24750, null],
                close: [24820, null],
                volume: [100000, null],
              },
            ],
          },
        },
      ],
    },
  };

  const series = parseYahooHistoricalResponse(nullLatestPayload, '^NSEI', '1mo', 1729300000 * 1000);
  assert.equal(series.isLatestCandleComplete, false);
  assert.equal(series.isOfficialCloseVerified, false);
  assert.equal(series.latestCandleFormation, 'INVALID_OR_MISSING');
  assert.equal(
    series.latestCandleFormationLabel,
    'Latest daily candle invalid or missing — official close unverified.'
  );
});

test('[HISTORICAL-DATA] rejects malformed timestamps (null, NaN, negative, zero, non-numeric) without corrupting valid candles', () => {
  const malformedPayload = {
    chart: {
      result: [
        {
          meta: { symbol: 'TCS.NS', currency: 'INR' },
          timestamp: [null, NaN, -5000, 0, 'invalid_ts', Infinity, 1729139400, 1729225800],
          indicators: {
            quote: [
              {
                open: [4000, 4000, 4000, 4000, 4000, 4000, 4100, 4120],
                high: [4050, 4050, 4050, 4050, 4050, 4050, 4150, 4160],
                low: [3950, 3950, 3950, 3950, 3950, 3950, 4080, 4100],
                close: [4010, 4010, 4010, 4010, 4010, 4010, 4125, 4140],
                volume: [1000, 1000, 1000, 1000, 1000, 1000, 2500, 3000],
              },
            ],
          },
        },
      ],
    },
  };

  const series = parseYahooHistoricalResponse(malformedPayload, 'TCS.NS', '1mo');
  assert.equal(series.malformedTimestamps, 6);
  assert.equal(series.totalCandles, 2);
  assert.equal(series.validCandles, 2);
  assert.equal(series.candles[0].close, 4125);
  assert.equal(series.candles[1].close, 4140);
});

test('[HISTORICAL-DATA] correctly sorts unordered timestamps and deduplicates identical timestamps', () => {
  const unorderedPayload = {
    chart: {
      result: [
        {
          meta: { symbol: 'TCS.NS', currency: 'INR' },
          timestamp: [1729312200, 1729139400, 1729225800, 1729225800],
          indicators: {
            quote: [
              {
                open: [4100, 4000, 4050, 4050],
                high: [4150, 4050, 4100, 4100],
                low: [4080, 3980, 4030, 4030],
                close: [4120, 4020, 4080, 4080],
                volume: [1000, 2000, 1500, 1500],
              },
            ],
          },
        },
      ],
    },
  };

  const series = parseYahooHistoricalResponse(unorderedPayload, 'TCS.NS', '1mo');

  assert.equal(series.wasOutOfOrder, true);
  assert.equal(series.duplicateTimestampsRemoved, 1);
  assert.equal(series.totalCandles, 3);
  assert.equal(series.candles[0].timestamp, 1729139400000);
  assert.equal(series.candles[1].timestamp, 1729225800000);
  assert.equal(series.candles[2].timestamp, 1729312200000);
  assert.equal(series.candles[0].close, 4020);
  assert.equal(series.candles[1].close, 4080);
  assert.equal(series.candles[2].close, 4120);
});

test('[HISTORICAL-DATA] distinguishes NULL_CLOSE, NULL_OHLC, and INVALID_PRICE and excludes all from indicator inputs', () => {
  const edgePayload = {
    chart: {
      result: [
        {
          meta: { symbol: 'INFY.NS', currency: 'INR' },
          timestamp: [
            1729053000, // 0: valid candle
            1729139400, // 1: null close
            1729225800, // 2: close present, but high is null -> must be NULL_OHLC
            1729485000, // 3: negative close -> INVALID_PRICE
            1729571400, // 4: inverted envelope (high < low) -> INVALID_PRICE
            1729657800, // 5: close > high -> INVALID_PRICE
          ],
          indicators: {
            quote: [
              {
                open: [1900, 1920, 1910, 1910, 1900, 1900],
                high: [1950, 1940, null, 1930, 1850, 1920],
                low: [1880, 1890, 1880, 1880, 1890, 1880],
                close: [1910, null, 1905, -50, 1870, 1960],
                volume: [1000, null, 1000, 1000, 1000, 1000],
              },
            ],
          },
        },
      ],
    },
  };

  const series = parseYahooHistoricalResponse(edgePayload, 'INFY.NS', '1mo');
  assert.equal(series.totalCandles, 6);
  assert.equal(series.validCandles, 1);
  assert.equal(series.missingCandles, 5);
  assert.equal(series.nullCloseCandles, 1);
  assert.equal(series.nullOhlcCandles, 1);
  assert.equal(series.invalidPriceCandles, 3);

  const indicatorInputs = extractIndicatorInputPrices(series);
  assert.deepEqual(indicatorInputs, [1910, null, null, null, null, null]);

  // Verify indicator calculations propagate null across invalid/missing candles
  const sma3 = calculateSMA(indicatorInputs, 3);
  assert.deepEqual(sma3, [null, null, null, null, null, null]);
  const rsi14 = calculateRSI(indicatorInputs, 14);
  assert.deepEqual(rsi14, [null, null, null, null, null, null]);
  const macd = calculateMACD(indicatorInputs, 12, 26, 9);
  assert.deepEqual(macd.macd, [null, null, null, null, null, null]);
});

test('[HISTORICAL-DATA] Stage 3.3 & 4B Prep Calendar Coverage: classifies 2021 & 2027+ as CALENDAR_UNVERIFIED, verifies 2022-2026 official circulars, and never flags unverified weekdays as missing sessions', () => {
  // 2021 (prior to 2022-2026 verified range) and 2027 (provisional) must be classified as CALENDAR_UNVERIFIED
  assert.equal(classifyExchangeCalendarDate('2021-05-11', 'NSE'), 'CALENDAR_UNVERIFIED');
  assert.equal(classifyExchangeCalendarDate('2021-08-15', 'NSE'), 'CALENDAR_UNVERIFIED');
  assert.equal(classifyExchangeCalendarDate('2027-01-26', 'NSE'), 'CALENDAR_UNVERIFIED');

  // Verified years 2022-2026 distinguish SPECIAL_SESSION, CONFIRMED_EXCHANGE_HOLIDAY, WEEKEND, and VERIFIED_TRADING_DAY
  assert.equal(classifyExchangeCalendarDate('2022-01-26', 'NSE'), 'CONFIRMED_EXCHANGE_HOLIDAY'); // Republic Day 2022
  assert.equal(classifyExchangeCalendarDate('2022-10-24', 'NSE'), 'SPECIAL_SESSION'); // Diwali Muhurat 2022
  assert.equal(classifyExchangeCalendarDate('2023-08-15', 'NSE'), 'CONFIRMED_EXCHANGE_HOLIDAY'); // Independence Day 2023
  assert.equal(classifyExchangeCalendarDate('2024-01-20', 'NSE'), 'SPECIAL_SESSION'); // Saturday DR Full Trading Session 2024
  assert.equal(classifyExchangeCalendarDate('2024-01-22', 'NSE'), 'CONFIRMED_EXCHANGE_HOLIDAY'); // Ram Mandir Consecration Holiday 2024
  assert.equal(classifyExchangeCalendarDate('2025-02-01', 'NSE'), 'SPECIAL_SESSION'); // Union Budget Saturday 2025
  assert.equal(classifyExchangeCalendarDate('2025-10-21', 'NSE'), 'SPECIAL_SESSION'); // Diwali Muhurat 2025
  assert.equal(classifyExchangeCalendarDate('2026-01-26', 'NSE'), 'CONFIRMED_EXCHANGE_HOLIDAY'); // Republic Day 2026
  assert.equal(classifyExchangeCalendarDate('2026-01-15', 'NSE'), 'CONFIRMED_EXCHANGE_HOLIDAY'); // Maharashtra Municipal Election 2026
  assert.equal(classifyExchangeCalendarDate('2026-10-17', 'NSE'), 'WEEKEND'); // Saturday
  assert.equal(classifyExchangeCalendarDate('2026-10-21', 'NSE'), 'VERIFIED_TRADING_DAY'); // Normal Wednesday

  // Audit a span in unverified year 2021: omitted weekday (2021-08-17) must NOT be in missingSessionDates!
  const audit2021 = auditHistoricalSessionCalendar(
    '2021-08-16',
    '2021-08-18',
    new Set(['2021-08-16', '2021-08-18']),
    'NSE'
  );
  assert.equal(audit2021.calendarCoverageStatus, 'CALENDAR_UNVERIFIED');
  assert.deepEqual(audit2021.missingSessionDates, [], 'Never mark weekday in unverified year as missing session');
  assert.deepEqual(audit2021.unverifiedCalendarDates, ['2021-08-17']);
});

test('[HISTORICAL-DATA] Stage 3.3 Calendar Coverage: distinguishes confirmed holidays, special sessions, and genuinely missing verified trading sessions', () => {
  // Span in verified year 2026: Wed 2026-01-14 to Wed 2026-01-28
  //Suppose provider has candles on all regular trading days EXCEPT Tue 2026-01-20 (genuinely missing),
  // and omits Thu 2026-01-15 (Confirmed Holiday) and Mon 2026-01-26 (Confirmed Holiday Republic Day)
  const presentDates = new Set([
    '2026-01-14',
    // '2026-01-15' is Municipal Corporation Election Holiday
    '2026-01-16',
    // '2026-01-17', '2026-01-18' are Weekend
    '2026-01-19',
    // '2026-01-20' is a VERIFIED_TRADING_DAY that is genuinely missing!
    '2026-01-21',
    '2026-01-22',
    '2026-01-23',
    // '2026-01-24', '2026-01-25' are Weekend
    // '2026-01-26' is Republic Day Holiday
    '2026-01-27',
    '2026-01-28',
  ]);

  const audit2026 = auditHistoricalSessionCalendar('2026-01-14', '2026-01-28', presentDates, 'NSE');
  assert.equal(audit2026.calendarCoverageStatus, 'FULLY_VERIFIED');
  assert.deepEqual(audit2026.confirmedHolidayDates, ['2026-01-15', '2026-01-26']);
  assert.deepEqual(audit2026.missingSessionDates, ['2026-01-20']);
  assert.deepEqual(audit2026.unverifiedCalendarDates, []);

  // Also verify findMissingTradingSessions returns only the verified missing trading day
  assert.deepEqual(
    findMissingTradingSessions('2026-01-14', '2026-01-28', presentDates, 'NSE'),
    ['2026-01-20']
  );
});

test('[HISTORICAL-DATA] rejects empty or malformed JSON payloads', () => {
  assert.throws(() => {
    parseYahooHistoricalResponse(null, '^NSEI');
  }, /Invalid JSON response/);

  assert.throws(() => {
    parseYahooHistoricalResponse({ chart: { error: { description: 'Symbol not found' } } }, 'INVALID');
  }, /Historical data error for INVALID/);
});

test('[HISTORICAL-DATA] formatISTDateOnly formats date correctly and handles invalid input', () => {
  const dateStr = formatISTDateOnly(1729139400000);
  assert.equal(dateStr, '2024-10-17');
  assert.equal(formatISTDateOnly(NaN), 'N/A');
  assert.equal(formatISTDateOnly(-100), 'N/A');
});

test('[HISTORICAL-DATA] Stage 4B Gate Audit: rejects synthetic zero-volume flat equity placeholder bars on missing trading days (2025-03-18) and confirmed holidays (2026-01-15)', () => {
  // 2025-03-17 (Mon, valid), 2025-03-18 (Tue, VERIFIED_TRADING_DAY with v=0 flat copy), 2026-01-15 (Thu, CONFIRMED_EXCHANGE_HOLIDAY with v=0 flat copy)
  const tsMar17 = Math.floor(Date.UTC(2025, 2, 17, 10, 0, 0) / 1000);
  const tsMar18 = Math.floor(Date.UTC(2025, 2, 18, 10, 0, 0) / 1000);
  const tsJan15 = Math.floor(Date.UTC(2026, 0, 15, 10, 0, 0) / 1000);

  const payload = {
    chart: {
      result: [
        {
          meta: { symbol: 'RELIANCE.NS', exchangeName: 'NSE', instrumentType: 'EQUITY', currency: 'INR' },
          timestamp: [tsMar17, tsMar18, tsJan15],
          indicators: {
            quote: [
              {
                open: [1242.15, 1238.85, 1458.8],
                high: [1257.4, 1238.85, 1458.8],
                low: [1233.1, 1238.85, 1458.8],
                close: [1238.85, 1238.85, 1458.8],
                volume: [16640917, 0, 0],
              },
            ],
          },
        },
      ],
    },
  };

  const series = parseYahooHistoricalResponse(payload, 'RELIANCE.NS', '1y');
  assert.equal(series.totalCandles, 3);
  assert.equal(series.validCandles, 1);
  assert.equal(series.invalidPriceCandles, 2);
  assert.equal(series.genuinelyMissingTradingCandles, 1); // 2025-03-18
  assert.equal(series.holidayOrSpecialNullCandles, 1); // 2026-01-15
  assert.equal(series.candles[1].isMissing, true);
  assert.equal(series.candles[1].status, 'INVALID_PRICE');
  assert.equal(series.candles[2].isMissing, true);
  assert.equal(series.candles[2].status, 'INVALID_PRICE');
  assert.ok(series.missingSessionDates.includes('2025-03-18'));
  assert.ok(!series.missingSessionDates.includes('2026-01-15'));
  assert.ok(series.confirmedHolidayDates.includes('2026-01-15'));
  assert.deepEqual(extractIndicatorInputPrices(series), [1238.85, null, null]);
});

