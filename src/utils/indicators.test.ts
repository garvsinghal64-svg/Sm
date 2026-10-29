/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateSMA,
  calculateEMA,
  calculateRSI,
  calculateMACD,
  calculateGeneralizedEMA,
} from './indicators.ts';

test('[INDICATORS] SMA 20 on 20 identical prices equals the constant price', () => {
  const prices = new Array(20).fill(150);
  const sma20 = calculateSMA(prices, 20);

  assert.equal(sma20.length, 20);
  // Indices 0..18 must be null (insufficient window)
  for (let i = 0; i < 19; i++) {
    assert.equal(sma20[i], null, `index ${i} should be null`);
  }
  // Index 19 is exactly 150
  assert.equal(sma20[19], 150);
});

test('[INDICATORS] SMA 20 on 1..20 sequence calculates exact mean of 10.5', () => {
  const prices = Array.from({ length: 20 }, (_, i) => i + 1); // 1 to 20
  const sma20 = calculateSMA(prices, 20);

  // Sum of 1..20 = 210, 210 / 20 = 10.5
  assert.equal(sma20[19], 10.5);
});

test('[INDICATORS] SMA 50 on short history (< 50 items) returns array of nulls', () => {
  const shortHistory = new Array(35).fill(2500);
  const sma50 = calculateSMA(shortHistory, 50);

  assert.equal(sma50.length, 35);
  assert.ok(sma50.every((v) => v === null), 'All values must be null when length < period');
});

test('[INDICATORS] SMA window containing null or non-positive value returns null and does not fabricate', () => {
  const prices: (number | null)[] = Array.from({ length: 25 }, () => 100);
  prices[15] = null; // missing candle in provider data

  const sma20 = calculateSMA(prices, 20);

  // At index 19, the 20-candle window includes index 15 (which is null), so sma20[19] must be null
  assert.equal(sma20[19], null, 'SMA must be null when window contains missing candle');
  // At index 20, window (1..20) still includes index 15 -> null
  assert.equal(sma20[20], null);
  // After index 35 (if we had enough valid continuous items after 15), it would resume
});

test('[INDICATORS] RSI 14 with all gains yields exactly 100', () => {
  // 15 prices strictly increasing: 10, 11, 12, ... 24 (14 positive gains of +1, 0 losses)
  const prices = Array.from({ length: 15 }, (_, i) => 10 + i);
  const rsi = calculateRSI(prices, 14);

  assert.equal(rsi.length, 15);
  for (let i = 0; i < 14; i++) {
    assert.equal(rsi[i], null);
  }
  assert.equal(rsi[14], 100, 'RSI with zero losses must be 100');
});

test('[INDICATORS] RSI 14 with all losses yields exactly 0', () => {
  // 15 prices strictly decreasing: 100, 99, 98, ... 86 (14 losses of -1, 0 gains)
  const prices = Array.from({ length: 15 }, (_, i) => 100 - i);
  const rsi = calculateRSI(prices, 14);

  assert.equal(rsi.length, 15);
  assert.equal(rsi[14], 0, 'RSI with zero gains must be 0');
});

test('[INDICATORS] RSI 14 with equal gains and losses yields 50', () => {
  // Alternating prices: 100, 102, 100, 102 ... (gains = 2, losses = 2 equal)
  const prices = [
    100, 102, 100, 102, 100, 102, 100, 102,
    100, 102, 100, 102, 100, 102, 100
  ]; // 15 points = 14 changes (7 gains of 2, 7 losses of 2)
  const rsi = calculateRSI(prices, 14);

  assert.equal(rsi[14], 50, 'RSI with equal avg gain and avg loss must be 50');
});

test('[INDICATORS] RSI on short history (< 15 points) returns all nulls', () => {
  const shortHistory = [100, 101, 102, 103, 104];
  const rsi = calculateRSI(shortHistory, 14);

  assert.equal(rsi.length, 5);
  assert.ok(rsi.every((v) => v === null));
});

test('[INDICATORS] RSI does not fabricate across missing candle', () => {
  const prices: (number | null)[] = Array.from({ length: 25 }, (_, i) => 100 + (i % 2 === 0 ? 1 : -1));
  prices[10] = null; // missing candle

  const rsi = calculateRSI(prices, 14);
  assert.equal(rsi[10], null);
  assert.equal(rsi[14], null, 'Must be null because continuous 14-period window is broken by missing candle');
});

test('[INDICATORS] MACD on short history (< 26 periods) returns all nulls', () => {
  const shortPrices = new Array(20).fill(100);
  const result = calculateMACD(shortPrices, 12, 26, 9);

  assert.equal(result.macd.length, 20);
  assert.ok(result.macd.every((v) => v === null));
  assert.ok(result.signal.every((v) => v === null));
  assert.ok(result.histogram.every((v) => v === null));
});

test('[INDICATORS] MACD on constant price sequence converges to 0 line and 0 histogram', () => {
  // Constant price: EMA(12) == EMA(26) == price, so MACD line = 0, signal = 0, hist = 0
  const prices = new Array(60).fill(500);
  const result = calculateMACD(prices, 12, 26, 9);

  // Index 59 is well beyond slow period (26) + signal period (9)
  assert.equal(result.macd[59], 0);
  assert.equal(result.signal[59], 0);
  assert.equal(result.histogram[59], 0);
});

test('[INDICATORS] Hand-calculated reference fixture: SMA 20 on 25-item arithmetic sequence (values 10..34 at indices 0..24)', () => {
  // 25 items total: index i has price value (10 + i), so prices[0] = 10, prices[19] = 29, prices[24] = 34
  const prices = Array.from({ length: 25 }, (_, i) => 10 + i);
  assert.equal(prices.length, 25);
  assert.equal(prices[0], 10);
  assert.equal(prices[19], 29);
  assert.equal(prices[24], 34);

  const sma20 = calculateSMA(prices, 20);
  assert.equal(sma20.length, 25);

  // Indices 0..18 (first 19 items) have fewer than 20 observations -> must be null
  for (let i = 0; i <= 18; i++) {
    assert.equal(sma20[i], null, `sma20[${i}] must be null (only ${i + 1} items in window)`);
  }

  // At array index 19 (20th element): window covers indices 0..19 -> price values 10..29 -> sum = 390 -> mean = 19.5
  const windowAt19 = prices.slice(0, 20);
  assert.equal(windowAt19[0], 10);
  assert.equal(windowAt19[19], 29);
  assert.equal(sma20[19], 19.5);

  // At array index 20 (21st element): window covers indices 1..20 -> price values 11..30 -> sum = 410 -> mean = 20.5
  const windowAt20 = prices.slice(1, 21);
  assert.equal(windowAt20[0], 11);
  assert.equal(windowAt20[19], 30);
  assert.equal(sma20[20], 20.5);

  // At array index 24 (25th element): window covers indices 5..24 -> price values 15..34 -> sum = 490 -> mean = 24.5
  const windowAt24 = prices.slice(5, 25);
  assert.equal(windowAt24[0], 15);
  assert.equal(windowAt24[19], 34);
  assert.equal(sma20[24], 24.5);
});

test('[INDICATORS] Hand-calculated reference fixture: SMA 50 on sequence 1..50', () => {
  const prices = Array.from({ length: 50 }, (_, i) => i + 1); // 1 to 50
  const sma50 = calculateSMA(prices, 50);

  // Sum = 50 * 51 / 2 = 1275, 1275 / 50 = 25.5
  assert.equal(sma50[49], 25.5);
  assert.equal(sma50[48], null, 'Index 48 must be null (only 49 items)');
});

test('[INDICATORS] Hand-calculated reference fixture: J. Welles Wilder 1978 textbook 16-period RSI', () => {
  const wilderPrices = [
    44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42,
    45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.00
  ];
  const rsi = calculateRSI(wilderPrices, 14);

  // Initial RSI at index 14 is exactly 70.46
  assert.equal(rsi[14], 70.46, 'Initial 14-period Wilder RSI must equal 70.46');
  // First smoothed RSI at index 15 is exactly 66.25
  assert.equal(rsi[15], 66.25, 'First smoothed Wilder RSI step must equal 66.25');
});

test('[INDICATORS] MACD on continuously rising prices is strictly positive and falling is strictly negative', () => {
  const risingPrices = Array.from({ length: 50 }, (_, i) => i + 1);
  const macdRising = calculateMACD(risingPrices, 12, 26, 9);

  // Once both 12 and 26 EMAs are initialized (index 25), fast EMA exceeds slow EMA
  assert.ok(macdRising.macd[25]! > 0, `Rising MACD at index 25 must be > 0, got ${macdRising.macd[25]}`);
  assert.ok(macdRising.macd[49]! > 0, `Rising MACD at index 49 must be > 0, got ${macdRising.macd[49]}`);

  const fallingPrices = Array.from({ length: 50 }, (_, i) => 100 - i);
  const macdFalling = calculateMACD(fallingPrices, 12, 26, 9);

  assert.ok(macdFalling.macd[25]! < 0, `Falling MACD at index 25 must be < 0, got ${macdFalling.macd[25]}`);
  assert.ok(macdFalling.macd[49]! < 0, `Falling MACD at index 49 must be < 0, got ${macdFalling.macd[49]}`);
});

test('[INDICATORS] MACD signal line and histogram boundary: exactly 33 vs 34 items', () => {
  // 33 items: MACD line exists at indices 25..32 (8 items), but Signal line requires 9 MACD items!
  const prices33 = Array.from({ length: 33 }, (_, i) => 100 + i);
  const res33 = calculateMACD(prices33, 12, 26, 9);
  assert.notEqual(res33.macd[32], null, 'MACD line exists at index 32');
  assert.equal(res33.signal[32], null, 'Signal line must be null at index 32 (only 8 MACD items)');
  assert.equal(res33.histogram[32], null, 'Histogram must be null when signal is null');

  // 34 items: 9th MACD item appears at index 33 -> Signal line and Histogram are now initialized
  const prices34 = Array.from({ length: 34 }, (_, i) => 100 + i);
  const res34 = calculateMACD(prices34, 12, 26, 9);
  assert.notEqual(res34.signal[33], null, 'Signal line must be initialized at index 33');
  assert.notEqual(res34.histogram[33], null, 'Histogram must be initialized at index 33');
});

test('[INDICATORS] Invalid inputs (empty arrays, strings, negatives, non-integers) safely handled', () => {
  assert.deepEqual(calculateSMA([], 20), []);
  assert.deepEqual(calculateSMA([1, 2, 3], -5), []);
  assert.deepEqual(calculateRSI([], 14), []);
  assert.deepEqual(calculateMACD([], 12, 26, 9), { macd: [], signal: [], histogram: [] });

  const invalidPrices = [-50, NaN, null, undefined, 0, Infinity] as any;
  const sma = calculateSMA(invalidPrices, 3);
  assert.ok(sma.every((v) => v === null));
});
