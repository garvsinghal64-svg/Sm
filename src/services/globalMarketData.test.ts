/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert';
import {
  createDeterministicMacroFixture,
  assessMacroRegime,
  MACRO_INSTRUMENTS_CONFIG,
  MacroIndicatorItem,
} from './globalMarketData.ts';

test('[MACRO CONTEXT] Deterministic fixture contains all required commodities, currencies and global indices', () => {
  const items = createDeterministicMacroFixture();

  assert.strictEqual(items.length, MACRO_INSTRUMENTS_CONFIG.length);

  const symbols = items.map((i) => i.symbol);
  assert.ok(symbols.includes('CL=F'), 'Crude oil must be present');
  assert.ok(symbols.includes('GC=F'), 'Gold must be present');
  assert.ok(symbols.includes('SI=F'), 'Silver must be present');
  assert.ok(symbols.includes('INR=X'), 'USD/INR must be present');
  assert.ok(symbols.includes('^GSPC'), 'S&P 500 must be present');
  assert.ok(symbols.includes('^IXIC'), 'Nasdaq must be present');
  assert.ok(symbols.includes('^NSEI'), 'Nifty 50 must be present');

  // Verify non-zero pricing and documented transmission mechanisms
  for (const item of items) {
    assert.ok(item.latestPrice !== null && item.latestPrice > 0);
    assert.ok(item.relevanceToIndia.length > 10);
    assert.ok(item.transmissionMechanism.length > 10);
    assert.ok(item.affectedSectors.length > 0);
  }
});

test('[MACRO REGIME] Assesses bullish regime when Nifty and global markets are positive', () => {
  const items = createDeterministicMacroFixture();
  // Modify for strong bullish regime
  const bullishItems: MacroIndicatorItem[] = items.map((item) => {
    if (item.symbol === '^NSEI') return { ...item, changePercent: 0.8 };
    if (item.symbol === '^GSPC') return { ...item, changePercent: 0.6 };
    if (item.symbol === '^IXIC') return { ...item, changePercent: 0.7 };
    if (item.symbol === 'CL=F') return { ...item, changePercent: -0.5 };
    return item;
  });

  const assessment = assessMacroRegime(bullishItems);
  assert.strictEqual(assessment.overallRegime, 'RISK_ON_BULLISH');
  assert.strictEqual(assessment.niftyTrend, 'UPTREND');
  assert.ok(assessment.confidenceScorePct >= 60);
});

test('[MACRO REGIME] Assesses bearish regime when crude surges and global indices drop', () => {
  const items = createDeterministicMacroFixture();
  const bearishItems: MacroIndicatorItem[] = items.map((item) => {
    if (item.symbol === '^NSEI') return { ...item, changePercent: -0.6 };
    if (item.symbol === '^GSPC') return { ...item, changePercent: -0.8 };
    if (item.symbol === '^IXIC') return { ...item, changePercent: -1.2 };
    if (item.symbol === 'CL=F') return { ...item, changePercent: 3.2 }; // crude spike
    return item;
  });

  const assessment = assessMacroRegime(bearishItems);
  assert.strictEqual(assessment.overallRegime, 'RISK_OFF_BEARISH');
  assert.strictEqual(assessment.niftyTrend, 'DOWNTREND');
  assert.strictEqual(assessment.crudePressure, 'ELEVATED_HEADWIND');
});
