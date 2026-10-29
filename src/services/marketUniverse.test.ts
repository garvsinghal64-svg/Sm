/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert';
import {
  MarketUniverseManager,
  DEFAULT_NSE_UNIVERSE,
  executeBatchScan,
  UniverseInstrument,
} from './marketUniverse.ts';

test('[UNIVERSE] Default universe contains liquid equities and spot indices', () => {
  const mgr = new MarketUniverseManager();
  const all = mgr.getAllInstruments();

  assert.ok(all.length >= 20, 'Universe should contain at least 20 liquid instruments');
  const symbols = all.map((i) => i.symbol);

  // Spot indices present
  assert.ok(symbols.includes('^NSEI'));
  assert.ok(symbols.includes('^NSEBANK'));
  assert.ok(symbols.includes('^BSESN'));

  // Core equities present
  assert.ok(symbols.includes('RELIANCE.NS'));
  assert.ok(symbols.includes('TCS.NS'));
  assert.ok(symbols.includes('INFY.NS'));
  assert.ok(symbols.includes('HDFCBANK.NS'));

  // Tradable vs context separation
  const tradable = mgr.getTradableEquities();
  const indices = mgr.getContextIndices();

  assert.strictEqual(tradable.every((i) => i.type === 'EQUITY'), true);
  assert.strictEqual(indices.every((i) => i.type === 'INDEX'), true);
  assert.strictEqual(tradable.length + indices.length, all.length);
});

test('[UNIVERSE] Add custom NSE symbol validates format and prevents duplicates', () => {
  const mgr = new MarketUniverseManager([...DEFAULT_NSE_UNIVERSE]);

  // Add without suffix should auto-append .NS
  const res1 = mgr.addSymbol('zomato', 'Zomato Ltd', 'Consumer Tech');
  assert.strictEqual(res1.success, true);
  assert.strictEqual(res1.instrument?.symbol, 'ZOMATO.NS');

  // Duplicate add should be rejected
  const resDup = mgr.addSymbol('ZOMATO.NS');
  assert.strictEqual(resDup.success, false);
  assert.ok(resDup.message.includes('already exists'));

  // Remove symbol
  const removed = mgr.removeSymbol('ZOMATO.NS');
  assert.strictEqual(removed, true);

  // Second remove returns false
  assert.strictEqual(mgr.removeSymbol('ZOMATO.NS'), false);
});

test('[UNIVERSE] Filter options exclude indices when requested', () => {
  const mgr = new MarketUniverseManager([...DEFAULT_NSE_UNIVERSE]);
  const withoutIndices = mgr.getEligibleUniverse({ includeIndices: false });

  assert.strictEqual(withoutIndices.some((i) => i.type === 'INDEX'), false);
  assert.strictEqual(withoutIndices.every((i) => i.type === 'EQUITY'), true);
});

test('[UNIVERSE] Batch scanner processes items in controlled batches with progress updates', async () => {
  const sampleItems: UniverseInstrument[] = [
    { symbol: 'RELIANCE.NS', name: 'Reliance', exchange: 'NSE', type: 'EQUITY' },
    { symbol: 'TCS.NS', name: 'TCS', exchange: 'NSE', type: 'EQUITY' },
    { symbol: 'INFY.NS', name: 'Infosys', exchange: 'NSE', type: 'EQUITY' },
    { symbol: 'FAIL.NS', name: 'Faulty', exchange: 'NSE', type: 'EQUITY' },
  ];

  const progressUpdates: number[] = [];

  const { results, summary } = await executeBatchScan(
    sampleItems,
    async (inst) => {
      if (inst.symbol === 'FAIL.NS') {
        throw new Error('Simulated network timeout');
      }
      return { price: 1000, volume: 50000 };
    },
    (p) => {
      progressUpdates.push(p.scannedCount);
    },
    { batchSize: 2, delayMs: 50 }
  );

  assert.strictEqual(results.length, 4);
  assert.strictEqual(summary.totalEligible, 4);
  assert.strictEqual(summary.scannedCount, 4);
  assert.strictEqual(summary.qualifiedCount, 3);
  assert.strictEqual(summary.failedCount, 1);
  assert.ok(summary.errorMessages.some((e) => e.includes('Simulated network timeout')));
  assert.ok(progressUpdates.length >= 2, 'Should emit multiple batch progress updates');
});
