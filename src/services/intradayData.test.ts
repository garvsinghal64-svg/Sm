/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert';
import {
  validateIntervalAndRange,
  isWithinRegularISTTradingHours,
  getSessionMinute,
  getISTTimeComponents,
  isCandleComplete,
  parseYahooIntradayResponse,
  createDeterministicIntradayFixture,
  validateLiveIntradayFreshness,
} from './intradayData.ts';

test('[STAGE 4D INTRADAY] Interval and range validation', () => {
  assert.strictEqual(validateIntervalAndRange('1m', '1d').isValid, true);
  assert.strictEqual(validateIntervalAndRange('1m', '5d').isValid, true);
  assert.strictEqual(validateIntervalAndRange('1m', '1mo').isValid, false); // rejected by free endpoint

  assert.strictEqual(validateIntervalAndRange('5m', '5d').isValid, true);
  assert.strictEqual(validateIntervalAndRange('5m', '1mo').isValid, true);
  assert.strictEqual(validateIntervalAndRange('5m', '1y').isValid, false); // rejected

  assert.strictEqual(validateIntervalAndRange('1d', '1y').isValid, true);
});

test('[STAGE 4D INTRADAY] IST session hours & session minute calculation', () => {
  // 09:15 IST -> Market open
  assert.strictEqual(isWithinRegularISTTradingHours(9, 15), true);
  assert.strictEqual(getSessionMinute(9, 15), 0);

  // 12:30 IST -> Midday
  assert.strictEqual(isWithinRegularISTTradingHours(12, 30), true);
  assert.strictEqual(getSessionMinute(12, 30), 195); // 3h 15m = 195 mins

  // 15:30 IST -> Market close
  assert.strictEqual(isWithinRegularISTTradingHours(15, 30), true);
  assert.strictEqual(getSessionMinute(15, 30), 375); // 6h 15m = 375 mins

  // 08:30 IST -> Pre-market (closed)
  assert.strictEqual(isWithinRegularISTTradingHours(8, 30), false);

  // 16:00 IST -> Post-market (closed)
  assert.strictEqual(isWithinRegularISTTradingHours(16, 0), false);
});

test('[STAGE 4D INTRADAY] Incomplete candle detection', () => {
  const barStart = 1700000000000;
  const bar5mDuration = 5 * 60 * 1000;

  // At 2 minutes into the bar, bar is still forming (incomplete)
  assert.strictEqual(isCandleComplete(barStart, '5m', barStart + 2 * 60 * 1000), false);

  // At 5 minutes exactly or after, bar is completed
  assert.strictEqual(isCandleComplete(barStart, '5m', barStart + bar5mDuration), true);
  assert.strictEqual(isCandleComplete(barStart, '5m', barStart + bar5mDuration + 1000), true);
});

test('[STAGE 4D INTRADAY] Deterministic intraday fixture generation', () => {
  const fixture = createDeterministicIntradayFixture('RELIANCE.NS', '2026-10-21', '5m', 2500);
  assert.strictEqual(fixture.metadata.symbol, 'RELIANCE.NS');
  assert.strictEqual(fixture.metadata.interval, '5m');
  assert.strictEqual(fixture.candles.length, 75); // 375 mins / 5 = 75 bars

  // Verify first bar is 09:15
  assert.strictEqual(fixture.candles[0].timeString, '09:15');
  assert.strictEqual(fixture.candles[0].sessionMinute, 0);

  // Verify last bar is 15:25 (covering up to 15:30)
  assert.strictEqual(fixture.candles[74].timeString, '15:25');
  assert.strictEqual(fixture.candles[74].sessionMinute, 370);

  // All bars are valid OHLC envelopes
  for (const c of fixture.candles) {
    assert.strictEqual(c.isValid, true);
    assert.ok(c.low <= c.high);
    assert.ok(c.open >= c.low && c.open <= c.high);
    assert.ok(c.close >= c.low && c.close <= c.high);
    assert.ok(c.volume > 0);
  }
});

test('[STAGE 4D INTRADAY] Deduplication and out-of-order sorting', () => {
  const mockYahooJson = {
    chart: {
      result: [
        {
          meta: { symbol: 'TCS.NS', currency: 'INR' },
          timestamp: [1700000600, 1700000300, 1700000300, 1700000900], // out of order & duplicate
          indicators: {
            quote: [
              {
                open: [100, 95, 95, 105],
                high: [102, 97, 97, 107],
                low: [99, 94, 94, 104],
                close: [101, 96, 96, 106],
                volume: [1000, 500, 500, 2000],
              },
            ],
          },
        },
      ],
    },
  };

  const parsed = parseYahooIntradayResponse(mockYahooJson, 'TCS.NS', '5m', '1d', 1700002000 * 1000);
  assert.strictEqual(parsed.metadata.outOfOrderBarsCorrected, 1);
  assert.strictEqual(parsed.metadata.duplicateBarsRemoved, 1);
  assert.strictEqual(parsed.candles.length, 3);
  assert.strictEqual(parsed.candles[0].timestamp, 1700000300 * 1000);
  assert.strictEqual(parsed.candles[1].timestamp, 1700000600 * 1000);
  assert.strictEqual(parsed.candles[2].timestamp, 1700000900 * 1000);
});

test('[STAGE 4D INTRADAY] Freshness validation rejects offline fixtures and stale candles in live mode', () => {
  // 1. Offline fixture is never marked as live fresh data
  const fixture = createDeterministicIntradayFixture('RELIANCE.NS', '2026-10-29', '5m', 2500);
  const resFixture = validateLiveIntradayFreshness(fixture);
  assert.strictEqual(resFixture.isFresh, false);
  assert.strictEqual(resFixture.dataStatus, 'OFFLINE_DEMO');

  // 2. Live series during market hours (e.g. 2026-10-29 11:30 IST)
  // 2026-10-29 11:30:00 IST = 2026-10-29 06:00:00 UTC
  const nowDuringMarketMs = Date.UTC(2026, 9, 29, 6, 0, 0);
  // Candle 90 minutes old (10:00 IST) -> STALE_DATA
  const staleBarSec = Math.floor((nowDuringMarketMs - 90 * 60 * 1000) / 1000);
  const staleYahooJson = {
    chart: {
      result: [
        {
          meta: { symbol: 'INFY.NS', currency: 'INR' },
          timestamp: [staleBarSec],
          indicators: {
            quote: [{ open: [1800], high: [1810], low: [1795], close: [1805], volume: [10000] }],
          },
        },
      ],
    },
  };
  const parsedStale = parseYahooIntradayResponse(staleYahooJson, 'INFY.NS', '5m', '1d', nowDuringMarketMs);
  const resStale = validateLiveIntradayFreshness(parsedStale, nowDuringMarketMs);
  assert.strictEqual(resStale.isFresh, false);
  assert.strictEqual(resStale.dataStatus, 'STALE_DATA');
  assert.ok(resStale.reason?.includes('stale'));

  // 3. Fresh candle 15 minutes old (11:15 IST) -> LIVE_INTRADAY & isFresh = true
  const freshBarSec = Math.floor((nowDuringMarketMs - 15 * 60 * 1000) / 1000);
  const freshYahooJson = {
    chart: {
      result: [
        {
          meta: { symbol: 'INFY.NS', currency: 'INR' },
          timestamp: [freshBarSec],
          indicators: {
            quote: [{ open: [1800], high: [1810], low: [1795], close: [1805], volume: [10000] }],
          },
        },
      ],
    },
  };
  const parsedFresh = parseYahooIntradayResponse(freshYahooJson, 'INFY.NS', '5m', '1d', nowDuringMarketMs);
  const resFresh = validateLiveIntradayFreshness(parsedFresh, nowDuringMarketMs);
  assert.strictEqual(resFresh.isFresh, true);
  assert.strictEqual(resFresh.dataStatus, 'LIVE_INTRADAY');
});

