/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { HistoricalDataProvider, HistoricalSeries } from './historicalData.ts';
import { SUPPORTED_INSTRUMENTS } from './marketDataProvider.ts';
import {
  buildMultiInstrumentPredictionDataset,
  prepareLeakageFreeResearchSplits,
  compareBaselinesOnEvaluationSplit,
} from '../utils/predictionResearch.ts';

test('[INTEGRATION] External Yahoo Finance Historical API returns valid series for all 7 instruments', async () => {
  const provider = new HistoricalDataProvider();

  for (const inst of SUPPORTED_INSTRUMENTS) {
    const series = await provider.getHistoricalData(inst.symbol, '1mo');
    assert.equal(series.symbol, inst.symbol);
    assert.ok(series.totalCandles > 0, `Expected candles for ${inst.symbol}, got ${series.totalCandles}`);
    assert.ok(series.validCandles > 0, `Expected valid candles for ${inst.symbol}`);
    assert.ok(series.latestCandleTimestamp > 0);
  }
});

test('[INTEGRATION] Stage 4A Research Pipeline builds leakage-free 1Y dataset and evaluates baselines across all 7 live instruments', async () => {
  const provider = new HistoricalDataProvider();
  const seriesList: HistoricalSeries[] = [];

  for (const inst of SUPPORTED_INSTRUMENTS) {
    const series = await provider.getHistoricalData(inst.symbol, '1y');
    seriesList.push(series);
  }

  const multiDataset = buildMultiInstrumentPredictionDataset(seriesList, {
    forecastHorizonSessions: 1,
    minLookbackCandles: 50,
  });

  assert.equal(multiDataset.instrumentCount, 7);
  assert.ok(multiDataset.totalUsableObservations > 700);

  for (const inst of SUPPORTED_INSTRUMENTS) {
    const ds = multiDataset.datasetsBySymbol[inst.symbol];
    assert.ok(ds.usableObservations.length > 100, `Expected >100 usable 1Y observations for ${inst.symbol}`);

    const split = prepareLeakageFreeResearchSplits(ds.usableObservations, 0.7, 0.15, 0.15);
    assert.equal(split.isStrictlyChronological, true);
    assert.equal(split.hasOverlappingWindows, false);
    assert.equal(split.hasMissingObservations, false);

    const testComparison = compareBaselinesOnEvaluationSplit(split.test, 'TEST', {
      transactionCostBpsPerTurn: 10,
    });
    assert.equal(testComparison.isAligned, true);
    assert.equal(testComparison.sampleCount, split.test.length);
  }
});

test('[INTEGRATION] Stage 4B Preparation builds 5Y (2022-2026 verified calendar) dataset and runs 4-fold expanding walk-forward validation across all 7 instruments', async () => {
  const { runExpandingWalkForwardValidation } = await import('../utils/predictionResearch.ts');
  const provider = new HistoricalDataProvider();
  const seriesList: HistoricalSeries[] = [];

  for (const inst of SUPPORTED_INSTRUMENTS) {
    const series = await provider.getHistoricalData(inst.symbol, '5y');
    seriesList.push(series);
  }

  const multiDataset = buildMultiInstrumentPredictionDataset(seriesList, {
    forecastHorizonSessions: 1,
    minLookbackCandles: 50,
    excludeUnverifiedCalendarDates: true,
  });

  assert.equal(multiDataset.instrumentCount, 7);
  // Across 7 instruments over 2022-2026 verified sessions (~1,082-1,184 usable per instrument), total > 7,500
  assert.ok(
    multiDataset.totalUsableObservations > 7500,
    `Expected >7,500 verified 5Y observations, got ${multiDataset.totalUsableObservations}`
  );

  for (const inst of SUPPORTED_INSTRUMENTS) {
    const ds = multiDataset.datasetsBySymbol[inst.symbol];
    assert.ok(
      ds.usableObservations.length >= 1000,
      `Expected >=1,000 verified 2022-2026 observations for ${inst.symbol}, got ${ds.usableObservations.length}`
    );
    assert.equal(ds.unverifiedCalendarObservationCount, 0);

    const wf = runExpandingWalkForwardValidation(ds.usableObservations, {
      numFolds: 4,
      minInitialTrainRatio: 0.4,
      holdoutTestRatio: 0.15,
      allowShortSelling: inst.type === 'INDEX',
      executionBasis: 'NEXT_OPEN_TO_CLOSE',
    });

    assert.equal(wf.isStrictlyChronological, true);
    assert.equal(wf.hasZeroFoldOverlap, true);
    assert.equal(wf.folds.length, 4);
    assert.ok(wf.totalWalkForwardValidationSamples >= 400);
    assert.ok(wf.holdoutTestSampleCount >= 150);
    assert.equal(wf.pooledWalkForwardComparison.isAligned, true);
    assert.equal(wf.holdoutTestComparison.isAligned, true);
  }
});

