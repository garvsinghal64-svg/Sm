/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert';
import {
  calculateIntradayVWAP,
  calculateOpeningRange,
  calculateIntradayATR,
  scanIntradaySetups,
} from './intradayScanner.ts';
import { createDeterministicIntradayFixture } from '../services/intradayData.ts';

test('[STAGE 4E SCANNER] VWAP calculation from session start', () => {
  const fixture = createDeterministicIntradayFixture('RELIANCE.NS', '2026-10-21', '5m', 2500);
  const vwapSeries = calculateIntradayVWAP(fixture.candles);

  assert.strictEqual(vwapSeries.length, fixture.candles.length);
  // First candle VWAP is exactly its typical price
  const first = fixture.candles[0];
  const expectedFirstVWAP = (first.high + first.low + first.close) / 3;
  assert.strictEqual(Math.round(vwapSeries[0]! * 100) / 100, Math.round(expectedFirstVWAP * 100) / 100);

  // All VWAP values should be positive and finite
  for (const v of vwapSeries) {
    assert.ok(v !== null && Number.isFinite(v) && v > 0);
  }
});

test('[STAGE 4E SCANNER] Opening Range (ORB) calculation', () => {
  const fixture = createDeterministicIntradayFixture('RELIANCE.NS', '2026-10-21', '5m', 2500);
  // First 15 minutes = bars at 09:15, 09:20, 09:25 (sessionMinute 0, 5, 10 < 15)
  const { orbHigh, orbLow, orbFormed } = calculateOpeningRange(fixture.candles, 15);

  assert.strictEqual(orbFormed, true);
  assert.ok(orbHigh !== null && orbLow !== null);
  assert.ok(orbHigh >= orbLow);

  const orbBars = fixture.candles.slice(0, 3);
  const maxHigh = Math.max(...orbBars.map((b) => b.high));
  const minLow = Math.min(...orbBars.map((b) => b.low));
  assert.strictEqual(orbHigh, maxHigh);
  assert.strictEqual(orbLow, minLow);
});

test('[STAGE 4E SCANNER] Causal no-lookahead guarantee', () => {
  const fixture = createDeterministicIntradayFixture('RELIANCE.NS', '2026-10-21', '5m', 2500);

  // Scan at bar 25
  const candidatesAt25 = scanIntradaySetups(fixture, 25);

  // Mutate bar 40 (future bar) drastically
  const mutatedCandles = [...fixture.candles];
  mutatedCandles[40] = {
    ...mutatedCandles[40],
    close: 99999,
    high: 100000,
  };
  const mutatedFixture = { ...fixture, candles: mutatedCandles };

  // Scan at bar 25 again on mutated fixture
  const candidatesAt25AfterFutureMutation = scanIntradaySetups(mutatedFixture, 25);

  // Future bar 40 change CANNOT mathematically influence bar 25 signals!
  assert.deepStrictEqual(candidatesAt25, candidatesAt25AfterFutureMutation);
});

test('[STAGE 4E SCANNER] Non-tradable spot index proxies are disqualified', () => {
  const indexFixture = createDeterministicIntradayFixture('^NSEI', '2026-10-21', '5m', 24000);
  const candidates = scanIntradaySetups(indexFixture);

  // For any candidate on ^NSEI, it must be DISQUALIFIED with explicit reason
  for (const c of candidates) {
    assert.strictEqual(c.isTradableCashEquity, false);
    assert.strictEqual(c.status, 'DISQUALIFIED');
    assert.ok(c.rejectionReason?.includes('Spot Index Proxy'));
  }
});
