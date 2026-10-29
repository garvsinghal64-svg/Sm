/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { SUPPORTED_INSTRUMENTS } from '../services/historicalData.ts';
import {
  FEATURE_NAMES,
  OFFLINE_FIXTURE_PROVENANCE_LABEL,
  EVALUATION_LIMITATIONS_DISCLOSURE,
  BaselinePredictionPoint,
  createDeterministicOfflineResearchFixture,
  buildHistoricalPredictionDataset,
  buildMultiInstrumentPredictionDataset,
  fitTrainingPreprocessor,
  prepareLeakageFreeResearchSplits,
  evaluateBaselinePredictions,
  verifyAlignedEvaluationComparison,
  compareBaselinesOnEvaluationSplit,
  runExpandingWalkForwardValidation,
  classifyInstrumentTradability,
  getRealisticIndianMarketCostPreset,
  calculateIndianEquityTradeCostBreakdown,
  ONE_TURNOVER_UNIT_DEFINITION,
} from './predictionResearch.ts';

test('[STAGE 4A] Builds reproducible offline dataset across all 7 supported instruments with complete observation schema', () => {
  const fixtures = SUPPORTED_INSTRUMENTS.map((inst, idx) =>
    createDeterministicOfflineResearchFixture({
      symbol: inst.symbol,
      candleCount: 110,
      startYear: 2025,
      basePrice: 1000 + idx * 500,
    })
  );

  const multiDataset = buildMultiInstrumentPredictionDataset(fixtures, {
    forecastHorizonSessions: 1,
    minLookbackCandles: 50,
  });

  assert.equal(multiDataset.instrumentCount, 7);
  assert.equal(multiDataset.symbols.length, 7);
  assert.equal(multiDataset.totalRawCandlesAcrossInstruments, 7 * 110);
  // Each 110-candle series with 50-candle warmup and 1-session forward horizon yields 110 - 50 = 60 observations
  assert.equal(multiDataset.totalUsableObservations, 7 * 60);

  for (const inst of SUPPORTED_INSTRUMENTS) {
    const ds = multiDataset.datasetsBySymbol[inst.symbol];
    assert.ok(ds, `Missing dataset for ${inst.symbol}`);
    assert.equal(ds.symbol, inst.symbol);
    assert.equal(ds.exchange, inst.exchange);
    assert.equal(ds.instrumentType, inst.type);
    assert.equal(ds.usableObservations.length, 60);
    assert.equal(ds.dataSource, OFFLINE_FIXTURE_PROVENANCE_LABEL);
    assert.equal(ds.priceAdjustmentBasis, 'SPLIT_ADJUSTED_UNADJUSTED_DIVIDEND');

    const sampleObs = ds.usableObservations[0];
    assert.equal(sampleObs.symbol, inst.symbol);
    assert.equal(sampleObs.lookbackWindowLength, 50);
    assert.equal(sampleObs.availableWindowCandles.length, 50);
    assert.equal(
      sampleObs.windowStartTimestamp,
      sampleObs.availableWindowCandles[0].timestamp
    );
    assert.equal(
      sampleObs.windowEndTimestamp,
      sampleObs.availableWindowCandles[49].timestamp
    );
    assert.equal(sampleObs.timestamp, sampleObs.windowEndTimestamp);
    assert.ok(sampleObs.targetTimestamp > sampleObs.timestamp);
    assert.ok(Number.isFinite(sampleObs.nextSessionOpen) && sampleObs.nextSessionOpen > 0);
    assert.ok(Number.isFinite(sampleObs.openToTargetReturnPct));
    assert.equal(sampleObs.forecastHorizonSessions, 1);
    assert.equal(sampleObs.targetWindowTimestamps.length, 1);
    assert.equal(sampleObs.featureValues.length, FEATURE_NAMES.length);
    assert.equal(sampleObs.sourceProvenance.isOfficialCloseVerified, false);
    assert.equal(sampleObs.sourceProvenance.provider, OFFLINE_FIXTURE_PROVENANCE_LABEL);
  }
});

test('[STAGE 4A LEAKAGE PROOF 1] Future observations cannot mathematically influence earlier features', () => {
  const baseSeries = createDeterministicOfflineResearchFixture({
    symbol: '^NSEI',
    candleCount: 120,
    startYear: 2025,
    basePrice: 24000,
  });

  // Create an alternate series identical up to index 80, but with extreme future shock at indices 81..119
  const shockedCandles = baseSeries.candles.map((c, idx) => {
    if (idx <= 80) {
      return { ...c };
    }
    return {
      ...c,
      open: (c.open as number) * 500,
      high: (c.high as number) * 500,
      low: (c.low as number) * 500,
      close: (c.close as number) * 500,
      adjClose: (c.adjClose as number) * 500,
    };
  });

  const shockedSeries = {
    ...baseSeries,
    candles: shockedCandles,
  };

  const dsClean = buildHistoricalPredictionDataset(baseSeries, {
    forecastHorizonSessions: 1,
    minLookbackCandles: 50,
  });
  const dsShocked = buildHistoricalPredictionDataset(shockedSeries, {
    forecastHorizonSessions: 1,
    minLookbackCandles: 50,
  });

  const cutoffTimestamp = baseSeries.candles[80].timestamp;

  const cleanUpToCutoff = dsClean.usableObservations.filter(
    (o) => o.timestamp <= cutoffTimestamp
  );
  const shockedUpToCutoff = dsShocked.usableObservations.filter(
    (o) => o.timestamp <= cutoffTimestamp
  );

  assert.ok(cleanUpToCutoff.length > 25);
  assert.equal(cleanUpToCutoff.length, shockedUpToCutoff.length);

  for (let i = 0; i < cleanUpToCutoff.length; i++) {
    // Every causal feature and lookback candle up to index 80 must be 100% identical
    assert.deepEqual(
      cleanUpToCutoff[i].features,
      shockedUpToCutoff[i].features,
      `Feature mismatch at index ${i} (${cleanUpToCutoff[i].predictionDateIST})`
    );
    assert.deepEqual(
      cleanUpToCutoff[i].availableWindowCandles,
      shockedUpToCutoff[i].availableWindowCandles
    );
  }
});

test('[STAGE 4A LEAKAGE PROOF 2] Validation and test observations cannot influence training preprocessor statistics', () => {
  const series = createDeterministicOfflineResearchFixture({
    symbol: 'RELIANCE.NS',
    candleCount: 150,
    startYear: 2025,
    basePrice: 2800,
  });
  const ds = buildHistoricalPredictionDataset(series, {
    forecastHorizonSessions: 1,
    minLookbackCandles: 50,
  });

  const splitClean = prepareLeakageFreeResearchSplits(
    ds.usableObservations,
    0.7,
    0.15,
    0.15
  );

  // Corrupt all validation and test observations in the raw array with +1,000,000 feature outliers
  const trainMaxTs = splitClean.trainCutoffTimestamp;
  const corruptedObservations = ds.usableObservations.map((obs) => {
    if (obs.timestamp <= trainMaxTs) {
      return obs;
    }
    const corruptedFeatures = { ...obs.features };
    for (const key of FEATURE_NAMES) {
      corruptedFeatures[key] = 1_000_000;
    }
    return {
      ...obs,
      features: corruptedFeatures,
      featureValues: FEATURE_NAMES.map((k) => corruptedFeatures[k]),
    };
  });

  const splitCorruptedValTest = prepareLeakageFreeResearchSplits(
    corruptedObservations,
    0.7,
    0.15,
    0.15
  );

  // Training preprocessor statistics and scaled training vectors must be 100% identical
  assert.deepEqual(splitClean.preprocessor, splitCorruptedValTest.preprocessor);
  assert.deepEqual(splitClean.scaledTrain, splitCorruptedValTest.scaledTrain);

  // Also verify fitTrainingPreprocessor rejects any observation exceeding maxAllowedTimestamp
  assert.throws(
    () =>
      fitTrainingPreprocessor(splitClean.train, {
        maxAllowedTimestamp: splitClean.train[splitClean.train.length - 1].timestamp - 1,
      }),
    /Preprocessor lookahead leakage/
  );
});

test('[STAGE 4A LEAKAGE PROOF 3] Multi-session forward targets are purged at train/val/test boundaries', () => {
  const series = createDeterministicOfflineResearchFixture({
    symbol: 'TCS.NS',
    candleCount: 160,
    startYear: 2025,
    basePrice: 4000,
  });

  const dsMulti = buildHistoricalPredictionDataset(series, {
    forecastHorizonSessions: 5,
    minLookbackCandles: 50,
  });

  const splitRes = prepareLeakageFreeResearchSplits(
    dsMulti.usableObservations,
    0.7,
    0.15,
    0.15
  );

  assert.equal(splitRes.isStrictlyChronological, true);
  assert.equal(splitRes.hasOverlappingWindows, false);
  assert.ok(
    splitRes.purgedRecordCount >= 8,
    `Expected boundary embargo to purge overlapping 5-day horizon records across 2 boundaries, purged=${splitRes.purgedRecordCount}`
  );

  const valFirstTs = splitRes.validation[0].timestamp;
  const testFirstTs = splitRes.test[0].timestamp;

  // Verify no train observation has a targetTimestamp >= validation[0].timestamp
  for (const row of splitRes.train) {
    assert.ok(
      row.targetTimestamp < valFirstTs,
      `Train target (${row.targetTimestamp}) crossed into validation (${valFirstTs})`
    );
  }
  // Verify no validation observation has a targetTimestamp >= test[0].timestamp
  for (const row of splitRes.validation) {
    assert.ok(
      row.targetTimestamp < testFirstTs,
      `Validation target (${row.targetTimestamp}) crossed into test (${testFirstTs})`
    );
  }
});

test('[STAGE 4A DATA QUALITY] Handles incomplete intraday bars, missing candles, unverified calendars, and adjClose divergence', () => {
  // 1. Incomplete intraday bar at the end of series
  const intradaySeries = createDeterministicOfflineResearchFixture({
    symbol: '^NSEBANK',
    candleCount: 80,
    startYear: 2025,
    markLatestAsIncompleteIntraday: true,
  });
  const dsIntraday = buildHistoricalPredictionDataset(intradaySeries, {
    forecastHorizonSessions: 1,
    minLookbackCandles: 50,
  });
  // Both i = n-1 (as prediction bar) and i = n-2 (whose 1-day target is n-1) must be excluded as incompleteIntradayBars
  assert.equal(dsIntraday.exclusions.incompleteIntradayBars, 2);
  const lastCandleTs = intradaySeries.candles[intradaySeries.candles.length - 1].timestamp;
  assert.equal(
    dsIntraday.usableObservations.some(
      (o) => o.timestamp === lastCandleTs || o.targetTimestamp === lastCandleTs
    ),
    false
  );

  // 2. Missing candle at index 60: excludes 1 observation where index 60 is the target (i=59)
  // and 50 observations where index 60 is inside the 50-bar lookback window (i=60..109) = 51 total
  const missingSeries = createDeterministicOfflineResearchFixture({
    symbol: 'HDFCBANK.NS',
    candleCount: 130,
    startYear: 2025,
    injectMissingCandleAtIndices: [60],
  });
  const dsMissing = buildHistoricalPredictionDataset(missingSeries, {
    forecastHorizonSessions: 1,
    minLookbackCandles: 50,
  });
  assert.equal(dsMissing.exclusions.missingOrInvalidTargetCandles, 1);
  assert.equal(dsMissing.exclusions.missingOrInvalidLookbackCandles, 50);
  assert.equal(dsMissing.usableObservations.length, 130 - 49 - 1 - 51);
  assert.equal(
    dsMissing.usableObservations.some((o) => o.missingDataFlags.hasMissingInLookbackWindow),
    false
  );

  // 3. Unverified historical calendar dates (2021 is outside verified 2022-2026 calendar, whereas 2023 is now verified)
  const verified2023Series = createDeterministicOfflineResearchFixture({
    symbol: 'INFY.NS',
    candleCount: 90,
    startYear: 2023,
  });
  const dsVerified2023 = buildHistoricalPredictionDataset(verified2023Series, {
    excludeUnverifiedCalendarDates: true,
  });
  assert.equal(dsVerified2023.unverifiedCalendarObservationCount, 0);
  assert.ok(dsVerified2023.verifiedCalendarObservationCount > 0);

  const unverifiedSeries = createDeterministicOfflineResearchFixture({
    symbol: 'INFY.NS',
    candleCount: 90,
    startYear: 2021,
  });
  const dsFlaggedUnverified = buildHistoricalPredictionDataset(unverifiedSeries, {
    excludeUnverifiedCalendarDates: false,
  });
  assert.ok(dsFlaggedUnverified.unverifiedCalendarObservationCount > 0);
  assert.equal(
    dsFlaggedUnverified.usableObservations[0].missingDataFlags.isCalendarUnverified,
    true
  );

  const dsExcludedUnverified = buildHistoricalPredictionDataset(unverifiedSeries, {
    excludeUnverifiedCalendarDates: true,
  });
  assert.equal(dsExcludedUnverified.usableObservations.length, 0);
  assert.ok(dsExcludedUnverified.exclusions.unverifiedCalendarDatesExcluded > 0);

  // 4. Adjusted-close corporate-action divergence & target-horizon dividend event at index 70
  const adjDivSeries = createDeterministicOfflineResearchFixture({
    symbol: 'RELIANCE.NS',
    candleCount: 130,
    startYear: 2025,
    injectAdjustedDivergenceAtIndex: 70,
  });
  const dsFlaggedAdj = buildHistoricalPredictionDataset(adjDivSeries, {
    excludeAdjustedPriceDivergence: false,
  });
  assert.ok(dsFlaggedAdj.adjustedPriceDivergenceCount > 0);
  assert.equal(dsFlaggedAdj.targetDividendEventCount, 1);

  const divEventObs = dsFlaggedAdj.usableObservations.find(
    (o) => o.missingDataFlags.hasTargetHorizonDividendEvent
  );
  assert.ok(divEventObs, 'Expected observation at ex-dividend transition to be flagged');
  assert.ok(
    divEventObs.missingDataFlags.targetDividendAdjustmentPct !== null &&
      Math.abs(divEventObs.missingDataFlags.targetDividendAdjustmentPct) > 0.05
  );
  assert.ok(divEventObs.targetTotalReturnAdjClosePct !== null);

  const dsExcludedTargetDiv = buildHistoricalPredictionDataset(adjDivSeries, {
    excludeTargetDividendEvents: true,
  });
  assert.equal(dsExcludedTargetDiv.exclusions.targetDividendEventsExcluded, 1);
  assert.equal(
    dsExcludedTargetDiv.usableObservations.some(
      (o) => o.missingDataFlags.hasTargetHorizonDividendEvent
    ),
    false
  );

  const dsExcludedAdj = buildHistoricalPredictionDataset(adjDivSeries, {
    excludeAdjustedPriceDivergence: true,
  });
  assert.ok(dsExcludedAdj.exclusions.adjustedPriceDivergenceExcluded > 0);
  assert.equal(
    dsExcludedAdj.usableObservations.some((o) => o.missingDataFlags.hasAdjustedCloseDivergence),
    false
  );
});

test('[STAGE 4A BASELINES & METRICS] Evaluates No-Change, Return-Persistence, and Rule-Based baselines on identical test dates and horizon', () => {
  const series = createDeterministicOfflineResearchFixture({
    symbol: '^NSEI',
    candleCount: 160,
    startYear: 2025,
    basePrice: 22500,
  });

  const ds = buildHistoricalPredictionDataset(series, {
    forecastHorizonSessions: 1,
    minLookbackCandles: 50,
  });
  const split = prepareLeakageFreeResearchSplits(ds.usableObservations, 0.7, 0.15, 0.15);

  const comparison = compareBaselinesOnEvaluationSplit(split.test, 'TEST', {
    transactionCostBpsPerTurn: 10,
  });

  assert.equal(comparison.isAligned, true);
  assert.equal(comparison.sampleCount, split.test.length);
  assert.equal(comparison.forecastHorizonSessions, 1);

  const noChange = comparison.noChangeBaseline;
  const persistence = comparison.returnPersistenceBaseline;
  const ruleBased = comparison.ruleBasedBaseline;

  assert.equal(verifyAlignedEvaluationComparison(noChange.predictions, ruleBased.predictions), true);
  assert.equal(verifyAlignedEvaluationComparison(noChange.predictions, persistence.predictions), true);

  // Default execution basis is INTRADAY_NEXT_OPEN_TO_CLOSE
  assert.equal(noChange.metrics.executionBasis, 'INTRADAY_NEXT_OPEN_TO_CLOSE');
  assert.equal(ruleBased.metrics.executionBasis, 'INTRADAY_NEXT_OPEN_TO_CLOSE');

  // No-change baseline always predicts 0% return and 0 position exposure
  assert.ok(noChange.predictions.every((p) => p.predictedReturnPct === 0 && p.positionSignal === 0));
  assert.equal(noChange.metrics.activeCallCount, 0);
  assert.equal(noChange.metrics.exposurePct, 0);
  assert.equal(noChange.metrics.totalTurnoverUnits, 0);
  assert.equal(noChange.metrics.totalTransactionCostPct, 0);
  assert.equal(noChange.metrics.cumulativeReturnNetPct, 0);
  assert.equal(noChange.metrics.maxDrawdownPct, 0);
  assert.ok(noChange.metrics.maeReturnPct > 0);
  assert.ok(noChange.metrics.maePriceINR > 0);

  // Rule-based baseline produces valid finite error, directional, turnover, confidence intervals, and risk-aware metrics
  assert.ok(Number.isFinite(ruleBased.metrics.maeReturnPct));
  assert.ok(Number.isFinite(ruleBased.metrics.rmseReturnPct));
  assert.ok(Number.isFinite(ruleBased.metrics.maePriceINR));
  assert.ok(
    ruleBased.metrics.maeReturnCi95LowerPct <= ruleBased.metrics.maeReturnPct &&
      ruleBased.metrics.maeReturnPct <= ruleBased.metrics.maeReturnCi95UpperPct
  );
  assert.ok(
    ruleBased.metrics.directionalAccuracyPct >= 0 &&
      ruleBased.metrics.directionalAccuracyPct <= 100
  );
  assert.ok(ruleBased.metrics.maxDrawdownPct >= 0);
  assert.equal(ruleBased.metrics.transactionCostBpsPerTurn, 10);
  assert.equal(ruleBased.metrics.limitationsDisclosure, EVALUATION_LIMITATIONS_DISCLOSURE);
});

test('[STAGE 4A.1 HAND-CALCULATED REFERENCE FIXTURE] Verifies MAE, RMSE, Directional Accuracy, Turnover, Entry/Exit/Reversal Costs, Drawdown, Profit Factor, and Sharpe', () => {
  // 5-step hand-calculated prediction sequence (H = 1, 10 bps cost per turnover unit):
  // Step 0 (0 -> +1 entry): actual +2.00%, pred +1.00% | turnover=1, cost=0.10%, gross=+2.00%, net=+1.90%, eqNet=1.019
  // Step 1 (+1 -> +1 hold): actual -1.00%, pred +0.50% | turnover=0, cost=0.00%, gross=-1.00%, net=-1.00%, eqNet=1.00881 (dd=1.0000%)
  // Step 2 (+1 -> -1 rev):  actual -2.00%, pred -1.00% | turnover=2, cost=0.20%, gross=+2.00%, net=+1.80%, eqNet=1.02696858
  // Step 3 (-1 -> 0 exit):  actual +0.50%, pred  0.00% | turnover=1, cost=0.10%, gross= 0.00%, net=-0.10%, eqNet=1.02594161142
  // Step 4 (0 -> +1 entry): actual +1.00%, pred +1.00% | turnover=1, cost=0.10%, gross=+1.00%, net=+0.90%, eqNet=1.03517508592278
  const fixturePredictions: BaselinePredictionPoint[] = [
    {
      symbol: '^NSEI',
      predictionTimestamp: 1000,
      predictionDateIST: '2026-01-01',
      targetTimestamp: 2000,
      targetDateIST: '2026-01-02',
      forecastHorizonSessions: 1,
      currentClose: 100,
      nextSessionOpen: 100.5,
      actualTargetClose: 102,
      actualReturnPct: 2.0,
      openToTargetReturnPct: 1.5,
      actualDirection: 'UP',
      predictedTargetClose: 101,
      predictedReturnPct: 1.0,
      predictedDirection: 'UP',
      positionSignal: 1,
      baselineModelName: 'Hand-Calculated Reference Fixture',
      ruleExplanation: 'Step 0: Enter Long (+1)',
    },
    {
      symbol: '^NSEI',
      predictionTimestamp: 2000,
      predictionDateIST: '2026-01-02',
      targetTimestamp: 3000,
      targetDateIST: '2026-01-05',
      forecastHorizonSessions: 1,
      currentClose: 100,
      nextSessionOpen: 99.8,
      actualTargetClose: 99,
      actualReturnPct: -1.0,
      openToTargetReturnPct: -0.8,
      actualDirection: 'DOWN',
      predictedTargetClose: 100.5,
      predictedReturnPct: 0.5,
      predictedDirection: 'UP',
      positionSignal: 1,
      baselineModelName: 'Hand-Calculated Reference Fixture',
      ruleExplanation: 'Step 1: Hold Long (+1)',
    },
    {
      symbol: '^NSEI',
      predictionTimestamp: 3000,
      predictionDateIST: '2026-01-05',
      targetTimestamp: 4000,
      targetDateIST: '2026-01-06',
      forecastHorizonSessions: 1,
      currentClose: 100,
      nextSessionOpen: 99.5,
      actualTargetClose: 98,
      actualReturnPct: -2.0,
      openToTargetReturnPct: -1.5,
      actualDirection: 'DOWN',
      predictedTargetClose: 99,
      predictedReturnPct: -1.0,
      predictedDirection: 'DOWN',
      positionSignal: -1,
      baselineModelName: 'Hand-Calculated Reference Fixture',
      ruleExplanation: 'Step 2: Reverse Long to Short (+1 -> -1)',
    },
    {
      symbol: '^NSEI',
      predictionTimestamp: 4000,
      predictionDateIST: '2026-01-06',
      targetTimestamp: 5000,
      targetDateIST: '2026-01-07',
      forecastHorizonSessions: 1,
      currentClose: 100,
      nextSessionOpen: 100.1,
      actualTargetClose: 100.5,
      actualReturnPct: 0.5,
      openToTargetReturnPct: 0.4,
      actualDirection: 'UP',
      predictedTargetClose: 100,
      predictedReturnPct: 0.0,
      predictedDirection: 'FLAT',
      positionSignal: 0,
      baselineModelName: 'Hand-Calculated Reference Fixture',
      ruleExplanation: 'Step 3: Exit Short to Flat (-1 -> 0)',
    },
    {
      symbol: '^NSEI',
      predictionTimestamp: 5000,
      predictionDateIST: '2026-01-07',
      targetTimestamp: 6000,
      targetDateIST: '2026-01-08',
      forecastHorizonSessions: 1,
      currentClose: 100,
      nextSessionOpen: 100.4,
      actualTargetClose: 101,
      actualReturnPct: 1.0,
      openToTargetReturnPct: 0.6,
      actualDirection: 'UP',
      predictedTargetClose: 101,
      predictedReturnPct: 1.0,
      predictedDirection: 'UP',
      positionSignal: 1,
      baselineModelName: 'Hand-Calculated Reference Fixture',
      ruleExplanation: 'Step 4: Re-enter Long (0 -> +1)',
    },
  ];

  const report = evaluateBaselinePredictions(fixturePredictions, {
    transactionCostBpsPerTurn: 10,
    allowShortSelling: true,
    executionBasis: 'CLOSE_TO_CLOSE',
  });

  // 1. Forecast error assertions
  assert.equal(report.maeReturnPct, 0.8); // (1.0 + 1.5 + 1.0 + 0.5 + 0.0) / 5
  assert.equal(report.rmseReturnPct, 0.9487); // sqrt(4.5 / 5) = sqrt(0.9) = 0.948683...
  assert.equal(report.maePriceINR, 0.8); // (1.0 + 1.5 + 1.0 + 0.5 + 0.0) / 5

  // 2. Directional accuracy & active hit rate assertions
  assert.equal(report.directionalAccuracyPct, 60.0); // 3 / 5
  assert.equal(report.directionalAccuracyNumerator, 3);
  assert.equal(report.directionalAccuracyDenominator, 5);
  assert.equal(report.activeCallCount, 4);
  assert.equal(report.activeCallRatePct, 80.0); // 4 / 5
  assert.equal(report.activeDirectionalAccuracyPct, 75.0); // 3 / 4
  assert.equal(report.activeHitRateNumerator, 3);
  assert.equal(report.activeHitRateDenominator, 4);

  // 3. Exposure, trade count, and decomposed turnover cost assertions
  assert.equal(report.nonOverlappingStepCount, 5);
  assert.equal(report.longStepCount, 3);
  assert.equal(report.shortStepCount, 1);
  assert.equal(report.flatStepCount, 1);
  assert.equal(report.exposurePct, 80.0);
  assert.equal(report.tradeChangeCount, 4);
  assert.equal(report.entryCount, 3); // Step 0 entry, Step 2 reversal new leg, Step 4 entry
  assert.equal(report.exitCount, 2); // Step 2 reversal close leg, Step 3 exit to flat
  assert.equal(report.reversalCount, 1); // Step 2 (+1 -> -1)
  assert.equal(report.totalTurnoverUnits, 5); // 1 + 0 + 2 + 1 + 1
  assert.equal(report.totalTransactionCostPct, 0.5); // 5 * 0.10%
  assert.equal(report.totalBrokerageCostPct, 0.15); // 5 * 0.03%
  assert.equal(report.totalTaxesAndSttPct, 0.125); // 5 * 0.025%
  assert.equal(report.totalExchangeChargesPct, 0.025); // 5 * 0.005%
  assert.equal(report.totalSlippageCostPct, 0.2); // 5 * 0.04%
  assert.equal(report.terminalOpenPosition, 1);
  assert.equal(report.terminalLiquidationCostPct, 0.1);
  assert.equal(report.instrumentTradability, 'NON_TRADABLE_SPOT_INDEX_PROXY');

  // 4. Compounded return, drawdown, profit factor, volatility & Sharpe assertions
  assert.equal(report.cumulativeReturnGrossPct, 4.0296); // (1.02 * 0.99 * 1.02 * 1.00 * 1.01 - 1) * 100
  assert.equal(report.cumulativeReturnNetPct, 3.5175); // (1.019 * 0.99 * 1.018 * 0.999 * 1.009 - 1) * 100
  assert.equal(report.cumulativeReturnNetLiquidatedPct, 3.414); // after final 10 bps liquidation
  assert.equal(report.maxDrawdownPct, 1.0); // Step 1 drop from 1.019 by 1.00%
  assert.equal(report.grossProfitFactor, 5.0); // (2.0 + 2.0 + 1.0) / 1.0
  assert.equal(report.profitFactor, 4.1818); // (1.9 + 1.8 + 0.9) / (1.0 + 0.1 exit cost on flat Step 3)
  assert.equal(report.winRatePct, 75.0); // 3 winning active steps out of 4 active steps
  assert.equal(report.annualizedVolatilityPct, 19.7955); // sqrt(1.555) * sqrt(252)
  assert.equal(report.sharpeRatioZeroRf, 8.9111); // (0.70 / sqrt(1.555)) * sqrt(252) = 8.91114...
  assert.ok(report.sharpeRatioCi95Lower < report.sharpeRatioZeroRf);
  assert.ok(report.sharpeRatioCi95Upper > report.sharpeRatioZeroRf);

  // 5. Verify Long-Only mode (allowShortSelling: false maps Step 2 pos=-1 to 0)
  const reportLongOnly = evaluateBaselinePredictions(fixturePredictions, {
    transactionCostBpsPerTurn: 10,
    allowShortSelling: false,
    executionBasis: 'CLOSE_TO_CLOSE',
  });
  assert.equal(reportLongOnly.shortStepCount, 0);
  assert.equal(reportLongOnly.reversalCount, 0);
  assert.equal(reportLongOnly.totalTurnoverUnits, 3); // Step 0 (0->1), Step 2 (1->0), Step 4 (0->1)

  // 6. Verify Mode A: INTRADAY_NEXT_OPEN_TO_CLOSE execution basis (and verify it is the default when executionBasis is omitted)
  // Charges entry (1.0) + exit (1.0) = 2.0 turns on every active intraday round trip, and never carries a closed intraday position overnight!
  const reportIntraday = evaluateBaselinePredictions(fixturePredictions, {
    transactionCostBpsPerTurn: 10,
    allowShortSelling: true,
  });
  assert.equal(reportIntraday.executionBasis, 'INTRADAY_NEXT_OPEN_TO_CLOSE');
  assert.equal(reportIntraday.entryCount, 4); // Steps 0, 1, 2, 4 each enter at t+1 open
  assert.equal(reportIntraday.exitCount, 4); // Steps 0, 1, 2, 4 each exit at t+1 close
  assert.equal(reportIntraday.reversalCount, 0); // Flat overnight between every session
  assert.equal(reportIntraday.totalTurnoverUnits, 8); // 4 completed round trips * 2.0 turns
  assert.equal(reportIntraday.totalTransactionCostPct, 0.8); // 8 * 0.10%
  assert.equal(reportIntraday.terminalOpenPosition, 0);
  assert.equal(reportIntraday.terminalLiquidationCostPct, 0);
  assert.equal(reportIntraday.cumulativeReturnGrossPct, 2.8115); // (1.015 * 0.992 * 1.015 * 1.0 * 1.006 - 1) * 100
  assert.equal(reportIntraday.cumulativeReturnNetPct, 1.9971); // (1.013 * 0.990 * 1.013 * 1.0 * 1.004 - 1) * 100
  assert.equal(reportIntraday.cumulativeReturnNetLiquidatedPct, 1.9971);

  // 7. Verify Mode B: MULTI_DAY_POSITION execution basis
  // Signal formed after session t close executes at session t+1 open.
  // Prior position prevPosition is held across the overnight gap (Close_t -> Open_{t+1}) before rebalancing at Open_{t+1}:
  // - Step 0 (0 -> +1 at Open=100.5): overnight=0%, intraday=+1.50% -> gross=+1.50%, turnover=1, cost=0.10%, net=+1.40%
  // - Step 1 (+1 -> +1 held at Open=99.8): overnight=-0.20% (100->99.8), intraday=-0.80% -> gross=(0.998*0.992-1)*100=-0.9984%, turnover=0, cost=0.00%, net=-0.9984%
  // - Step 2 (+1 -> -1 rev at Open=99.5): overnight=+1*(-0.50%)=-0.50% (100->99.5), intraday=(-1)*(-1.50%)=+1.50% -> gross=(0.995*1.015-1)*100=+0.9925%, turnover=2, cost=0.20%, net=+0.7925%
  // - Step 3 (-1 -> 0 exit at Open=100.1): overnight=(-1)*(+0.10%)=-0.10% (100->100.1), intraday=0% -> gross=-0.10%, turnover=1, cost=0.10%, net=-0.20%
  // - Step 4 (0 -> +1 entry at Open=100.4): overnight=0%, intraday=+0.60% -> gross=+0.60%, turnover=1, cost=0.10%, net=+0.50%
  const reportMultiDay = evaluateBaselinePredictions(fixturePredictions, {
    transactionCostBpsPerTurn: 10,
    allowShortSelling: true,
    executionBasis: 'MULTI_DAY_POSITION',
  });
  assert.equal(reportMultiDay.executionBasis, 'MULTI_DAY_POSITION');
  assert.equal(reportMultiDay.entryCount, 3);
  assert.equal(reportMultiDay.exitCount, 2);
  assert.equal(reportMultiDay.reversalCount, 1);
  assert.equal(reportMultiDay.totalTurnoverUnits, 5); // 1 + 0 + 2 + 1 + 1
  assert.equal(reportMultiDay.totalTransactionCostPct, 0.5);
  assert.equal(reportMultiDay.terminalOpenPosition, 1);
  assert.equal(reportMultiDay.terminalLiquidationCostPct, 0.1);
  assert.equal(reportMultiDay.cumulativeReturnGrossPct, 1.9908); // (1.015 * 0.990016 * 1.009925 * 0.999 * 1.006 - 1) * 100
  assert.equal(reportMultiDay.cumulativeReturnNetPct, 1.4857);
  assert.equal(reportMultiDay.cumulativeReturnNetLiquidatedPct, 1.3842);
});

test('[STAGE 4B PREP WALK-FORWARD] Expanding-window walk-forward enforces strict chronological boundaries, multi-day target purging, fold-isolated preprocessing, and aligned baselines', () => {
  const series = createDeterministicOfflineResearchFixture({
    symbol: 'TCS.NS',
    candleCount: 220,
    startYear: 2024,
    basePrice: 3800,
  });

  // Test with multi-day horizon H = 3 to prove boundary target purging across every fold and holdout boundary
  const ds = buildHistoricalPredictionDataset(series, {
    forecastHorizonSessions: 3,
    minLookbackCandles: 50,
    excludeUnverifiedCalendarDates: true,
  });

  const wfClean = runExpandingWalkForwardValidation(ds.usableObservations, {
    numFolds: 4,
    minInitialTrainRatio: 0.4,
    holdoutTestRatio: 0.15,
    allowShortSelling: false,
    executionBasis: 'NEXT_OPEN_TO_CLOSE',
  });

  assert.equal(wfClean.symbol, 'TCS.NS');
  assert.equal(wfClean.instrumentTradability, 'CASH_EQUITY_LONG_ONLY_ELIGIBLE');
  assert.equal(wfClean.numFolds, 4);
  assert.equal(wfClean.isStrictlyChronological, true);
  assert.equal(wfClean.hasZeroFoldOverlap, true);
  assert.ok(wfClean.holdoutPurgedBoundaryCount >= 2);
  assert.equal(wfClean.folds.length, 4);

  let prevTrainCount = 0;
  let prevValMaxTs = 0;

  for (let idx = 0; idx < wfClean.folds.length; idx++) {
    const fold = wfClean.folds[idx];
    assert.equal(fold.foldIndex, idx + 1);
    // Training window strictly expands on each subsequent fold
    assert.ok(
      fold.trainSampleCount > prevTrainCount,
      `Fold ${fold.foldIndex} train count (${fold.trainSampleCount}) did not expand over previous (${prevTrainCount})`
    );
    prevTrainCount = fold.trainSampleCount;

    // Every training observation's forward targetTimestamp must be strictly < validation[0].timestamp
    for (const trainObs of fold.trainObservations) {
      assert.ok(
        trainObs.targetTimestamp < fold.validationMinTimestamp,
        `Fold ${fold.foldIndex} training target (${trainObs.targetTimestamp}) leaked into validation (${fold.validationMinTimestamp})`
      );
    }
    assert.ok(fold.purgedBoundaryRecordCount >= 2);

    // Validation fold must start strictly after previous validation fold ended
    if (prevValMaxTs > 0) {
      assert.ok(fold.validationMinTimestamp > prevValMaxTs);
    }
    prevValMaxTs = fold.validationMaxTimestamp;

    // Fold baselines are aligned and enforce long-only NEXT_OPEN_TO_CLOSE
    assert.equal(fold.comparison.isAligned, true);
    assert.equal(fold.comparison.ruleBasedBaseline.metrics.allowShortSelling, false);
    assert.equal(fold.comparison.ruleBasedBaseline.metrics.shortStepCount, 0);
    assert.equal(fold.comparison.ruleBasedBaseline.metrics.executionBasis, 'NEXT_OPEN_TO_CLOSE');
  }

  // Verify fold-level training-only preprocessing invariance:
  // Corrupt Fold 2 validation and holdout observations with +9,999,999 outliers; Fold 1 and Fold 2 preprocessors must remain 100% identical!
  const fold2ValMinTs = wfClean.folds[1].validationMinTimestamp;
  const corruptedObs = ds.usableObservations.map((obs) => {
    if (obs.timestamp < fold2ValMinTs) return obs;
    const badFeatures = { ...obs.features };
    for (const k of FEATURE_NAMES) badFeatures[k] = 9_999_999;
    return {
      ...obs,
      features: badFeatures,
      featureValues: FEATURE_NAMES.map((k) => badFeatures[k]),
    };
  });

  const wfCorrupted = runExpandingWalkForwardValidation(corruptedObs, {
    numFolds: 4,
    minInitialTrainRatio: 0.4,
    holdoutTestRatio: 0.15,
    allowShortSelling: false,
    executionBasis: 'NEXT_OPEN_TO_CLOSE',
  });

  assert.deepEqual(wfClean.folds[0].preprocessor, wfCorrupted.folds[0].preprocessor);
  assert.deepEqual(wfClean.folds[1].preprocessor, wfCorrupted.folds[1].preprocessor);
  assert.deepEqual(wfClean.folds[1].scaledTrain, wfCorrupted.folds[1].scaledTrain);

  // Verify pooled walk-forward comparison and holdout comparison alignment
  assert.equal(wfClean.pooledWalkForwardComparison.isAligned, true);
  assert.equal(
    wfClean.pooledWalkForwardComparison.sampleCount,
    wfClean.totalWalkForwardValidationSamples
  );
  assert.equal(wfClean.holdoutTestComparison.isAligned, true);
  assert.equal(wfClean.holdoutTestComparison.sampleCount, wfClean.holdoutTestSampleCount);
});

test('[STAGE 4B PREP TRADABILITY & DECOMPOSED COSTS] Classifies spot indices vs cash equities and decomposes custom Indian brokerage/STT/exchange/slippage bps', () => {
  assert.equal(
    classifyInstrumentTradability('^NSEI').tradability,
    'NON_TRADABLE_SPOT_INDEX_PROXY'
  );
  assert.equal(
    classifyInstrumentTradability('^BSESN').tradability,
    'NON_TRADABLE_SPOT_INDEX_PROXY'
  );
  assert.equal(
    classifyInstrumentTradability('RELIANCE.NS').tradability,
    'CASH_EQUITY_LONG_ONLY_ELIGIBLE'
  );

  const series = createDeterministicOfflineResearchFixture({
    symbol: 'HDFCBANK.NS',
    candleCount: 120,
    startYear: 2025,
    basePrice: 1650,
  });
  const ds = buildHistoricalPredictionDataset(series);
  const comp = compareBaselinesOnEvaluationSplit(ds.usableObservations.slice(0, 30), 'TEST', {
    brokerageBpsPerTurn: 2.0,
    sttAndTaxesBpsPerTurn: 10.0,
    exchangeAndSebiChargesBpsPerTurn: 0.5,
    slippageBpsPerTurn: 5.5,
    allowShortSelling: false,
  });

  const m = comp.returnPersistenceBaseline.metrics;
  assert.equal(m.instrumentTradability, 'CASH_EQUITY_LONG_ONLY_ELIGIBLE');
  assert.equal(m.allowShortSelling, false);
  assert.equal(m.shortStepCount, 0);
  assert.equal(m.transactionCostBpsPerTurn, 18.0); // 2.0 + 10.0 + 0.5 + 5.5
  assert.equal(m.brokerageBpsPerTurn, 2.0);
  assert.equal(m.sttAndTaxesBpsPerTurn, 10.0);
  assert.equal(m.exchangeAndSebiChargesBpsPerTurn, 0.5);
  assert.equal(m.slippageBpsPerTurn, 5.5);
  const sumParts = Number(
    (
      m.totalBrokerageCostPct +
      m.totalTaxesAndSttPct +
      m.totalExchangeChargesPct +
      m.totalSlippageCostPct
    ).toFixed(4)
  );
  assert.equal(sumParts, m.totalTransactionCostPct);

  // Verify statutory Indian market cost presets (Intraday MIS vs Delivery CNC vs Index Futures Proxy)
  const misPreset = getRealisticIndianMarketCostPreset('RELIANCE.NS', 'INTRADAY_NEXT_OPEN_TO_CLOSE');
  assert.equal(misPreset.presetName, 'CASH_EQUITY_INTRADAY_MIS');
  assert.equal(misPreset.buySide.totalCostBps, 9.20226);
  assert.equal(misPreset.sellSide.totalCostBps, 11.40226);
  assert.equal(misPreset.roundTripBps, 20.60452);
  assert.equal(misPreset.transactionCostBpsPerTurn, 10.30226);
  assert.equal(misPreset.sttAndTaxesBpsPerTurn, 1.4); // 1.25 bps STT + 0.15 bps Stamp Duty

  const cncPreset = getRealisticIndianMarketCostPreset('RELIANCE.NS', 'MULTI_DAY_POSITION');
  assert.equal(cncPreset.presetName, 'CASH_EQUITY_DELIVERY_CNC');
  assert.equal(cncPreset.buySide.totalCostBps, 16.86226);
  assert.equal(cncPreset.sellSide.totalCostBps, 16.95526);
  assert.equal(cncPreset.roundTripBps, 33.81752);
  assert.equal(cncPreset.transactionCostBpsPerTurn, 16.90876);
  assert.equal(cncPreset.sttAndTaxesBpsPerTurn, 10.75); // 10.00 bps CNC STT + 0.75 bps Stamp Duty

  const idxPreset = getRealisticIndianMarketCostPreset('^NSEI', 'MULTI_DAY_POSITION');
  assert.equal(idxPreset.presetName, 'INDEX_FUTURES_PROXY');
  assert.equal(idxPreset.buySide.totalCostBps, 7.27594);
  assert.equal(idxPreset.sellSide.totalCostBps, 9.07594);
  assert.equal(idxPreset.transactionCostBpsPerTurn, 8.17594);

  // Verify Newey-West HAC and effective sample size fields are populated
  assert.ok(m.effectiveIndependentSampleCount > 0);
  assert.ok(m.maeReturnHacCi95LowerPct <= m.maeReturnPct && m.maeReturnPct <= m.maeReturnHacCi95UpperPct);
  assert.ok(Number.isFinite(m.stepReturnLag1Autocorrelation));
  assert.ok(Number.isFinite(m.sharpeRatioHacSe));
});

test('[STAGE 4C.A ₹1,00,000 TRADE COST BREAKDOWN] Verifies exact INR & bps charges for ₹1,00,000 entry and exit orders across CASH_EQUITY_INTRADAY_MIS and CASH_EQUITY_DELIVERY_CNC', () => {
  // 1. CASH_EQUITY_INTRADAY_MIS — ₹1,00,000 trade (Uncapped 3.00 bps ad-valorem brokerage)
  const misUncapped = calculateIndianEquityTradeCostBreakdown({
    presetName: 'CASH_EQUITY_INTRADAY_MIS',
    referenceNotionalINR: 100_000,
    entryBuyNotionalINR: 100_000,
    exitSellNotionalINR: 100_000,
  });

  assert.equal(misUncapped.oneTurnoverUnitDefinition, ONE_TURNOVER_UNIT_DEFINITION);
  // BUY Entry (₹1,00,000): Brokerage ₹30.00, STT ₹0.00, Exchange ₹2.97, SEBI ₹0.10, DP ₹0.00, GST ₹5.9526, Stamp ₹3.00, Slippage ₹50.00
  assert.equal(misUncapped.entryBuyOrder.turnoverUnits, 1.0);
  assert.equal(misUncapped.entryBuyOrder.brokerageINR, 30.0);
  assert.equal(misUncapped.entryBuyOrder.sttINR, 0.0); // Strictly 0 on MIS BUY
  assert.equal(misUncapped.entryBuyOrder.exchangeTransactionChargesINR, 2.97);
  assert.equal(misUncapped.entryBuyOrder.sebiChargesINR, 0.1);
  assert.equal(misUncapped.entryBuyOrder.dpChargesINR, 0.0);
  assert.equal(misUncapped.entryBuyOrder.gstINR, 5.9526); // 18% of (30.00 + 2.97 + 0.10 = 33.07)
  assert.equal(misUncapped.entryBuyOrder.stampDutyINR, 3.0); // 0.003% on MIS BUY
  assert.equal(misUncapped.entryBuyOrder.estimatedSlippageINR, 50.0);
  assert.equal(misUncapped.entryBuyOrder.totalStatutoryAndExchangeINR, 42.0226);
  assert.equal(misUncapped.entryBuyOrder.totalCostINR, 92.0226);
  assert.equal(misUncapped.entryBuyOrder.totalCostBps, 9.20226);

  // SELL Exit (₹1,00,000): Brokerage ₹30.00, STT ₹25.00 (0.025%), Exchange ₹2.97, SEBI ₹0.10, DP ₹0.00, GST ₹5.9526, Stamp ₹0.00, Slippage ₹50.00
  assert.equal(misUncapped.exitSellOrder.turnoverUnits, 1.0);
  assert.equal(misUncapped.exitSellOrder.brokerageINR, 30.0);
  assert.equal(misUncapped.exitSellOrder.sttINR, 25.0); // 0.025% on MIS SELL only
  assert.equal(misUncapped.exitSellOrder.exchangeTransactionChargesINR, 2.97);
  assert.equal(misUncapped.exitSellOrder.sebiChargesINR, 0.1);
  assert.equal(misUncapped.exitSellOrder.dpChargesINR, 0.0);
  assert.equal(misUncapped.exitSellOrder.gstINR, 5.9526);
  assert.equal(misUncapped.exitSellOrder.stampDutyINR, 0.0); // Strictly 0 on SELL
  assert.equal(misUncapped.exitSellOrder.estimatedSlippageINR, 50.0);
  assert.equal(misUncapped.exitSellOrder.totalStatutoryAndExchangeINR, 64.0226);
  assert.equal(misUncapped.exitSellOrder.totalCostINR, 114.0226);
  assert.equal(misUncapped.exitSellOrder.totalCostBps, 11.40226);

  // Round-Trip MIS Total: ₹206.0452 (20.60452 bps round-trip, 10.30226 bps/turn)
  assert.equal(misUncapped.roundTripTotal.totalTurnoverUnits, 2.0);
  assert.equal(misUncapped.roundTripTotal.brokerageINR, 60.0);
  assert.equal(misUncapped.roundTripTotal.sttINR, 25.0);
  assert.equal(misUncapped.roundTripTotal.exchangeTransactionChargesINR, 5.94);
  assert.equal(misUncapped.roundTripTotal.sebiChargesINR, 0.2);
  assert.equal(misUncapped.roundTripTotal.dpChargesINR, 0.0);
  assert.equal(misUncapped.roundTripTotal.gstINR, 11.9052);
  assert.equal(misUncapped.roundTripTotal.stampDutyINR, 3.0);
  assert.equal(misUncapped.roundTripTotal.estimatedSlippageINR, 100.0);
  assert.equal(misUncapped.roundTripTotal.totalCostINR, 206.0452);
  assert.equal(misUncapped.roundTripTotal.roundTripBpsOfPositionNotional, 20.60452);
  assert.equal(misUncapped.roundTripTotal.averageBpsPerOneWayTurn, 10.30226);

  // 2. CASH_EQUITY_INTRADAY_MIS — ₹1,00,000 trade with ₹20/order Discount-Broker Cap
  const misCapped = calculateIndianEquityTradeCostBreakdown({
    presetName: 'CASH_EQUITY_INTRADAY_MIS',
    referenceNotionalINR: 100_000,
    entryBuyNotionalINR: 100_000,
    exitSellNotionalINR: 100_000,
    maxBrokeragePerOrderINR: 20,
  });
  assert.equal(misCapped.entryBuyOrder.brokerageINR, 20.0);
  assert.equal(misCapped.entryBuyOrder.gstINR, 4.1526); // 18% of (20.00 + 2.97 + 0.10 = 23.07)
  assert.equal(misCapped.entryBuyOrder.totalCostINR, 80.2226);
  assert.equal(misCapped.exitSellOrder.brokerageINR, 20.0);
  assert.equal(misCapped.exitSellOrder.gstINR, 4.1526);
  assert.equal(misCapped.exitSellOrder.totalCostINR, 102.2226);
  assert.equal(misCapped.roundTripTotal.totalCostINR, 182.4452);
  assert.equal(misCapped.roundTripTotal.averageBpsPerOneWayTurn, 9.12226);

  // 3. CASH_EQUITY_DELIVERY_CNC — ₹1,00,000 trade (Zero delivery brokerage + ₹13.50 DP charge + 18% GST on SELL)
  const cncBreakdown = calculateIndianEquityTradeCostBreakdown({
    presetName: 'CASH_EQUITY_DELIVERY_CNC',
    referenceNotionalINR: 100_000,
    entryBuyNotionalINR: 100_000,
    exitSellNotionalINR: 100_000,
  });
  // BUY Entry (₹1,00,000): Brokerage ₹0, STT ₹100.00 (0.10%), Exchange ₹2.97, SEBI ₹0.10, DP ₹0.00, GST ₹0.5526, Stamp ₹15.00 (0.015%), Slippage ₹50.00
  assert.equal(cncBreakdown.entryBuyOrder.brokerageINR, 0.0);
  assert.equal(cncBreakdown.entryBuyOrder.sttINR, 100.0);
  assert.equal(cncBreakdown.entryBuyOrder.exchangeTransactionChargesINR, 2.97);
  assert.equal(cncBreakdown.entryBuyOrder.sebiChargesINR, 0.1);
  assert.equal(cncBreakdown.entryBuyOrder.dpChargesINR, 0.0); // 0 DP charge on BUY
  assert.equal(cncBreakdown.entryBuyOrder.gstINR, 0.5526); // 18% of (2.97 + 0.10 = 3.07)
  assert.equal(cncBreakdown.entryBuyOrder.stampDutyINR, 15.0); // 0.015% on CNC BUY
  assert.equal(cncBreakdown.entryBuyOrder.estimatedSlippageINR, 50.0);
  assert.equal(cncBreakdown.entryBuyOrder.totalStatutoryAndExchangeINR, 118.6226);
  assert.equal(cncBreakdown.entryBuyOrder.totalCostINR, 168.6226);
  assert.equal(cncBreakdown.entryBuyOrder.totalCostBps, 16.86226);

  // SELL Exit (₹1,00,000): Brokerage ₹0, STT ₹100.00 (0.10%), Exchange ₹2.97, SEBI ₹0.10, DP ₹13.50, GST ₹2.9826 (18% of 16.57), Stamp ₹0.00, Slippage ₹50.00
  assert.equal(cncBreakdown.exitSellOrder.brokerageINR, 0.0);
  assert.equal(cncBreakdown.exitSellOrder.sttINR, 100.0);
  assert.equal(cncBreakdown.exitSellOrder.exchangeTransactionChargesINR, 2.97);
  assert.equal(cncBreakdown.exitSellOrder.sebiChargesINR, 0.1);
  assert.equal(cncBreakdown.exitSellOrder.dpChargesINR, 13.5); // ₹13.50 base DP charge on CNC SELL only
  assert.equal(cncBreakdown.exitSellOrder.gstINR, 2.9826); // 18% of (2.97 + 0.10 + 13.50 = 16.57)
  assert.equal(cncBreakdown.exitSellOrder.stampDutyINR, 0.0); // 0 Stamp Duty on SELL
  assert.equal(cncBreakdown.exitSellOrder.estimatedSlippageINR, 50.0);
  assert.equal(cncBreakdown.exitSellOrder.totalStatutoryAndExchangeINR, 119.5526);
  assert.equal(cncBreakdown.exitSellOrder.totalCostINR, 169.5526);
  assert.equal(cncBreakdown.exitSellOrder.totalCostBps, 16.95526);

  // Round-Trip CNC Total: ₹338.1752 (33.81752 bps round-trip, 16.90876 bps/turn)
  assert.equal(cncBreakdown.roundTripTotal.sttINR, 200.0);
  assert.equal(cncBreakdown.roundTripTotal.stampDutyINR, 15.0);
  assert.equal(cncBreakdown.roundTripTotal.dpChargesINR, 13.5);
  assert.equal(cncBreakdown.roundTripTotal.gstINR, 3.5352);
  assert.equal(cncBreakdown.roundTripTotal.totalCostINR, 338.1752);
  assert.equal(cncBreakdown.roundTripTotal.roundTripBpsOfPositionNotional, 33.81752);
  assert.equal(cncBreakdown.roundTripTotal.averageBpsPerOneWayTurn, 16.90876);

  // Verify provenance classifications distinguish STATUTORY_VERIFIED, EXCHANGE_REGULATED_VERIFIED, BROKER_DEPENDENT_CONFIGURABLE, EMPIRICAL_ESTIMATE_CONFIGURABLE
  const byComp = Object.fromEntries(cncBreakdown.provenance.map((p) => [p.component, p]));
  assert.equal(byComp.stt.classification, 'STATUTORY_VERIFIED');
  assert.equal(byComp.stampDuty.classification, 'STATUTORY_VERIFIED');
  assert.equal(byComp.sebiCharges.classification, 'STATUTORY_VERIFIED');
  assert.equal(byComp.gst.classification, 'STATUTORY_VERIFIED');
  assert.equal(byComp.exchangeTransactionCharges.classification, 'EXCHANGE_REGULATED_VERIFIED');
  assert.equal(byComp.brokerage.classification, 'BROKER_DEPENDENT_CONFIGURABLE');
  assert.equal(byComp.dpCharges.classification, 'BROKER_DEPENDENT_CONFIGURABLE');
  assert.equal(byComp.estimatedSlippage.classification, 'EMPIRICAL_ESTIMATE_CONFIGURABLE');
});

test('[STAGE 4C.A SIDE-SPECIFIC TURNOVER & PARTIAL REBALANCE] Verifies entry, exit, reversal, partial turnover, and terminal liquidation under side-asymmetric Indian costs', () => {
  const makePoint = (
    idx: number,
    positionSignal: -1 | 0 | 1,
    positionSize?: number
  ): BaselinePredictionPoint => ({
    symbol: 'RELIANCE.NS',
    predictionTimestamp: (idx + 1) * 86400_000,
    predictionDateIST: `2025-02-0${idx + 3}`,
    targetTimestamp: (idx + 2) * 86400_000,
    targetDateIST: `2025-02-0${idx + 4}`,
    forecastHorizonSessions: 1,
    currentClose: 1000,
    nextSessionOpen: 1000,
    actualTargetClose: 1000,
    actualReturnPct: 0,
    overnightGapReturnPct: 0,
    openToTargetReturnPct: 0,
    actualDirection: 'FLAT',
    predictedTargetClose: 1000,
    predictedReturnPct: 0,
    predictedDirection: positionSignal === 1 ? 'UP' : positionSignal === -1 ? 'DOWN' : 'FLAT',
    positionSignal,
    positionSize,
    baselineModelName: 'Stage 4C Side-Specific Cost Audit Fixture',
    ruleExplanation: 'Deterministic flat-price sequence isolating exact side-specific transaction costs.',
  });

  // Case 1: Standalone Entry (0 -> +1 BUY) held to end of backtest (terminal liquidation = SELL +1 -> 0)
  const entryOnlyReport = evaluateBaselinePredictions([makePoint(0, 1)], {
    executionBasis: 'MULTI_DAY_POSITION',
    useRealisticIndianCostPreset: true,
    allowShortSelling: false,
  });
  assert.equal(entryOnlyReport.totalBuyTurnoverUnits, 1.0);
  assert.equal(entryOnlyReport.totalSellTurnoverUnits, 0.0);
  assert.equal(entryOnlyReport.totalTurnoverUnits, 1.0);
  assert.equal(entryOnlyReport.totalSttCostPct, 0.1); // 10.00 bps BUY STT
  assert.equal(entryOnlyReport.totalStampDutyCostPct, 0.015); // 1.50 bps BUY Stamp Duty
  assert.equal(entryOnlyReport.totalDpChargesPct, 0.0); // 0 DP charge on BUY entry!
  assert.equal(entryOnlyReport.totalTransactionCostPct, 0.1686); // 16.86226 bps BUY cost
  assert.equal(entryOnlyReport.terminalOpenPosition, 1.0);
  assert.equal(entryOnlyReport.terminalLiquidationCostPct, 0.1696); // 16.95526 bps SELL liquidation cost!

  // Case 2: Entry (0 -> +1 BUY) followed by Exit to Cash (+1 -> 0 SELL)
  const entryExitReport = evaluateBaselinePredictions(
    [makePoint(0, 1), makePoint(1, 0)],
    {
      executionBasis: 'MULTI_DAY_POSITION',
      useRealisticIndianCostPreset: true,
      allowShortSelling: false,
    }
  );
  assert.equal(entryExitReport.entryCount, 1);
  assert.equal(entryExitReport.exitCount, 1);
  assert.equal(entryExitReport.totalBuyTurnoverUnits, 1.0);
  assert.equal(entryExitReport.totalSellTurnoverUnits, 1.0);
  assert.equal(entryExitReport.totalTurnoverUnits, 2.0);
  assert.equal(entryExitReport.totalSttCostPct, 0.2); // 10 bps BUY + 10 bps SELL = 20 bps
  assert.equal(entryExitReport.totalStampDutyCostPct, 0.015); // 1.5 bps on BUY only, 0 on SELL
  assert.equal(entryExitReport.totalDpChargesPct, 0.0135); // 1.35 bps on SELL only
  assert.equal(entryExitReport.totalGstCostPct, 0.0035); // (0.05526 + 0.29826) bps = 0.35352 bps = 0.0035352%
  assert.equal(entryExitReport.totalTransactionCostPct, 0.3382); // 33.81752 bps = 0.3381752%
  assert.equal(entryExitReport.terminalOpenPosition, 0);
  assert.equal(entryExitReport.terminalLiquidationCostPct, 0);

  // Case 3: Reversal (+1 -> -1 is 2.0 SELL turns; -1 -> +1 is 2.0 BUY turns)
  const reversalReport = evaluateBaselinePredictions(
    [makePoint(0, 1), makePoint(1, -1), makePoint(2, 1)],
    {
      executionBasis: 'CLOSE_TO_CLOSE',
      useRealisticIndianCostPreset: true,
      allowShortSelling: true,
    }
  );
  // Step 0: 0 -> +1 (1.0 BUY turn)
  // Step 1: +1 -> -1 (2.0 SELL turns: 1.0 sell to close long + 1.0 sell to open short)
  // Step 2: -1 -> +1 (2.0 BUY turns: 1.0 buy to cover short + 1.0 buy to open long)
  assert.equal(reversalReport.reversalCount, 2);
  assert.equal(reversalReport.totalBuyTurnoverUnits, 3.0);
  assert.equal(reversalReport.totalSellTurnoverUnits, 2.0);
  assert.equal(reversalReport.totalTurnoverUnits, 5.0);
  assert.equal(reversalReport.totalStampDutyCostPct, 0.045); // 3.0 BUY turns * 1.50 bps = 4.50 bps = 0.045%
  assert.equal(reversalReport.totalDpChargesPct, 0.027); // 2.0 SELL turns * 1.35 bps = 2.70 bps = 0.027%

  // Case 4: Partial Turnover (0 -> +0.4 -> +1.0 -> +0.25 -> 0)
  const partialTurnoverReport = evaluateBaselinePredictions(
    [
      makePoint(0, 1, 0.4), // +0.4 BUY entry
      makePoint(1, 1, 1.0), // +0.6 BUY scale-in
      makePoint(2, 1, 0.25), // -0.75 SELL partial exit
      makePoint(3, 0, 0.0), // -0.25 SELL final exit to cash
    ],
    {
      executionBasis: 'MULTI_DAY_POSITION',
      useRealisticIndianCostPreset: true,
      allowShortSelling: false,
    }
  );
  assert.equal(partialTurnoverReport.entryCount, 2); // 0 -> 0.4 and 0.4 -> 1.0
  assert.equal(partialTurnoverReport.exitCount, 2); // 1.0 -> 0.25 and 0.25 -> 0.0
  assert.equal(partialTurnoverReport.reversalCount, 0);
  assert.equal(partialTurnoverReport.totalBuyTurnoverUnits, 1.0); // 0.4 + 0.6
  assert.equal(partialTurnoverReport.totalSellTurnoverUnits, 1.0); // 0.75 + 0.25
  assert.equal(partialTurnoverReport.totalTurnoverUnits, 2.0);
  assert.equal(partialTurnoverReport.totalTransactionCostPct, 0.3382);
  assert.equal(partialTurnoverReport.terminalOpenPosition, 0);
});

test('[STAGE 4C.B DETERMINISTIC EXECUTION-MODE RETURN ACCOUNTING] Independently verifies hand-calculated returns across INTRADAY_NEXT_OPEN_TO_CLOSE, MULTI_DAY_POSITION, and CLOSE_TO_CLOSE', () => {
  // Construct a 5-step deterministic price trajectory with explicit Close_t, Open_{t+1}, and Close_{t+1}:
  // Step 0 (Long +1):  Close_0 = 100.00, Open_1 = 101.00 (+1.00% gap), Close_1 = 103.02 (+2.00% intraday, +3.02% close-to-close)
  // Step 1 (Hold +1):  Close_1 = 103.02, Open_2 = 101.9898 (-1.00% gap), Close_2 = 104.0296 (+2.00% intraday, +0.98% close-to-close)
  // Step 2 (Rev -1):   Close_2 = 104.0296, Open_3 = 105.0699 (+1.00% gap), Close_3 = 102.9685 (-2.00% intraday, -1.02% close-to-close)
  // Step 3 (Cash 0):   Close_3 = 102.9685, Open_4 = 101.9388 (-1.00% gap), Close_4 = 102.9582 (+1.00% intraday, -0.01% close-to-close)
  // Step 4 (Long +1):  Close_4 = 102.9582, Open_5 = 102.9582 (0.00% gap),  Close_5 = 104.0174 (+1.0288% intraday, +1.0288% close-to-close)
  const deterministicSeries: BaselinePredictionPoint[] = [
    {
      symbol: 'TCS.NS',
      predictionTimestamp: 1000,
      predictionDateIST: '2025-03-03',
      targetTimestamp: 2000,
      targetDateIST: '2025-03-04',
      forecastHorizonSessions: 1,
      currentClose: 100.0,
      nextSessionOpen: 101.0,
      actualTargetClose: 103.02,
      actualReturnPct: 3.02,
      overnightGapReturnPct: 1.0,
      openToTargetReturnPct: 2.0,
      actualDirection: 'UP',
      predictedTargetClose: 102.0,
      predictedReturnPct: 2.0,
      predictedDirection: 'UP',
      positionSignal: 1,
      baselineModelName: 'Stage 4C Return Accounting Fixture',
      ruleExplanation: 'Step 0 Long Entry (+1)',
    },
    {
      symbol: 'TCS.NS',
      predictionTimestamp: 2000,
      predictionDateIST: '2025-03-04',
      targetTimestamp: 3000,
      targetDateIST: '2025-03-05',
      forecastHorizonSessions: 1,
      currentClose: 103.02,
      nextSessionOpen: 101.9898,
      actualTargetClose: 104.0296,
      actualReturnPct: 0.98,
      overnightGapReturnPct: -1.0,
      openToTargetReturnPct: 2.0,
      actualDirection: 'UP',
      predictedTargetClose: 104.05,
      predictedReturnPct: 1.0,
      predictedDirection: 'UP',
      positionSignal: 1,
      baselineModelName: 'Stage 4C Return Accounting Fixture',
      ruleExplanation: 'Step 1 Persistent Long (+1)',
    },
    {
      symbol: 'TCS.NS',
      predictionTimestamp: 3000,
      predictionDateIST: '2025-03-05',
      targetTimestamp: 4000,
      targetDateIST: '2025-03-06',
      forecastHorizonSessions: 1,
      currentClose: 104.0296,
      nextSessionOpen: 105.0699,
      actualTargetClose: 102.9685,
      actualReturnPct: -1.02,
      overnightGapReturnPct: 1.0,
      openToTargetReturnPct: -2.0,
      actualDirection: 'DOWN',
      predictedTargetClose: 102.99,
      predictedReturnPct: -1.0,
      predictedDirection: 'DOWN',
      positionSignal: -1,
      baselineModelName: 'Stage 4C Return Accounting Fixture',
      ruleExplanation: 'Step 2 Reversal to Short (-1)',
    },
    {
      symbol: 'TCS.NS',
      predictionTimestamp: 4000,
      predictionDateIST: '2025-03-06',
      targetTimestamp: 5000,
      targetDateIST: '2025-03-07',
      forecastHorizonSessions: 1,
      currentClose: 102.9685,
      nextSessionOpen: 101.9388,
      actualTargetClose: 102.9582,
      actualReturnPct: -0.01,
      overnightGapReturnPct: -1.0,
      openToTargetReturnPct: 1.0,
      actualDirection: 'DOWN',
      predictedTargetClose: 102.9685,
      predictedReturnPct: 0.0,
      predictedDirection: 'FLAT',
      positionSignal: 0,
      baselineModelName: 'Stage 4C Return Accounting Fixture',
      ruleExplanation: 'Step 3 Transition to Cash (0)',
    },
    {
      symbol: 'TCS.NS',
      predictionTimestamp: 5000,
      predictionDateIST: '2025-03-07',
      targetTimestamp: 6000,
      targetDateIST: '2025-03-10',
      forecastHorizonSessions: 1,
      currentClose: 102.9582,
      nextSessionOpen: 102.9582,
      actualTargetClose: 103.9878,
      actualReturnPct: 1.0,
      overnightGapReturnPct: 0.0,
      openToTargetReturnPct: 1.0,
      actualDirection: 'UP',
      predictedTargetClose: 103.9878,
      predictedReturnPct: 1.0,
      predictedDirection: 'UP',
      positionSignal: 1,
      baselineModelName: 'Stage 4C Return Accounting Fixture',
      ruleExplanation: 'Step 4 Re-Entry Long (+1) held at terminal bar',
    },
  ];

  // Mode 1: INTRADAY_NEXT_OPEN_TO_CLOSE (10 bps/turn = 20 bps per active round trip)
  // Step 0 (+1): gross = +2.00%, cost = 0.20%, net = +1.80%
  // Step 1 (+1): gross = +2.00%, cost = 0.20%, net = +1.80%
  // Step 2 (-1): gross = (-1)*(-2.00%) = +2.00%, cost = 0.20%, net = +1.80%
  // Step 3 (0):  gross = 0.00%, cost = 0.00%, net = 0.00%
  // Step 4 (+1): gross = +1.00%, cost = 0.20%, net = +0.80%
  // Gross Equity = 1.02 * 1.02 * 1.02 * 1.00 * 1.01 = 1.07181992 -> +7.1820%
  // Net Equity   = 1.018 * 1.018 * 1.018 * 1.00 * 1.008 = 1.06341766 -> +6.3418%
  const intradayRep = evaluateBaselinePredictions(deterministicSeries, {
    executionBasis: 'INTRADAY_NEXT_OPEN_TO_CLOSE',
    transactionCostBpsPerTurn: 10,
    allowShortSelling: true,
  });
  assert.equal(intradayRep.totalBuyTurnoverUnits, 4.0);
  assert.equal(intradayRep.totalSellTurnoverUnits, 4.0);
  assert.equal(intradayRep.totalTurnoverUnits, 8.0);
  assert.equal(intradayRep.totalTransactionCostPct, 0.8);
  assert.equal(intradayRep.cumulativeReturnGrossPct, 7.182);
  assert.equal(intradayRep.cumulativeReturnNetPct, 6.3418);
  assert.equal(intradayRep.terminalOpenPosition, 0);
  assert.equal(intradayRep.cumulativeReturnNetLiquidatedPct, 6.3418);

  // Mode 2: MULTI_DAY_POSITION (10 bps/turn)
  // Step 0 (0 -> +1 at Open_1): overnight = 0%, intraday = +2.00% -> gross = +2.00%, turn = 1 (BUY), cost = 0.10%, net = +1.90%
  // Step 1 (+1 -> +1 at Open_2): overnight = (+1)*(-1.00%) = -1.00%, intraday = (+1)*(+2.00%) = +2.00% -> gross = (0.99 * 1.02 - 1)*100 = +0.98%, turn = 0, cost = 0.00%, net = +0.98%
  // Step 2 (+1 -> -1 at Open_3): overnight = (+1)*(+1.00%) = +1.00%, intraday = (-1)*(-2.00%) = +2.00% -> gross = (1.01 * 1.02 - 1)*100 = +3.02%, turn = 2 (SELL), cost = 0.20%, net = +2.82%
  // Step 3 (-1 -> 0 at Open_4):  overnight = (-1)*(-1.00%) = +1.00%, intraday = 0 * (+1.00%) = 0.00% -> gross = +1.00%, turn = 1 (BUY), cost = 0.10%, net = +0.90%
  // Step 4 (0 -> +1 at Open_5):  overnight = 0 * 0% = 0.00%, intraday = (+1)*(+1.00%) = +1.00% -> gross = +1.00%, turn = 1 (BUY), cost = 0.10%, net = +0.90%
  // Gross Equity = 1.02 * 1.0098 * 1.0302 * 1.01 * 1.01 = 1.08243003 -> +8.2430%
  // Net Equity   = 1.019 * 1.0098 * 1.0282 * 1.009 * 1.009 = 1.07713337 -> +7.7133%
  // Liquidated   = 1.07713337 * (1 - 0.001) = 1.07605624 -> +7.6056%
  const multiDayRep = evaluateBaselinePredictions(deterministicSeries, {
    executionBasis: 'MULTI_DAY_POSITION',
    transactionCostBpsPerTurn: 10,
    allowShortSelling: true,
  });
  assert.equal(multiDayRep.totalBuyTurnoverUnits, 3.0); // Step 0 (+1), Step 3 (+1), Step 4 (+1)
  assert.equal(multiDayRep.totalSellTurnoverUnits, 2.0); // Step 2 (-2)
  assert.equal(multiDayRep.totalTurnoverUnits, 5.0);
  assert.equal(multiDayRep.totalTransactionCostPct, 0.5);
  assert.equal(multiDayRep.cumulativeReturnGrossPct, 8.243);
  assert.equal(multiDayRep.cumulativeReturnNetPct, 7.7133);
  assert.equal(multiDayRep.terminalOpenPosition, 1);
  assert.equal(multiDayRep.terminalLiquidationCostPct, 0.1);
  assert.equal(multiDayRep.cumulativeReturnNetLiquidatedPct, 7.6056);

  // Mode 3: CLOSE_TO_CLOSE (10 bps/turn)
  // Step 0 (0 -> +1): gross = +3.02%, turn = 1, cost = 0.10%, net = +2.92%
  // Step 1 (+1 -> +1): gross = +0.98%, turn = 0, cost = 0.00%, net = +0.98%
  // Step 2 (+1 -> -1): gross = (-1)*(-1.02%) = +1.02%, turn = 2, cost = 0.20%, net = +0.82%
  // Step 3 (-1 -> 0):  gross = 0.00%, turn = 1, cost = 0.10%, net = -0.10%
  // Step 4 (0 -> +1):  gross = +1.00%, turn = 1, cost = 0.10%, net = +0.90%
  // Gross Equity = 1.0302 * 1.0098 * 1.0102 * 1.00 * 1.01 = 1.06141605 -> +6.1416%
  // Net Equity   = 1.0292 * 1.0098 * 1.0082 * 0.999 * 1.009 = 1.05618134 -> +5.6181%
  // Liquidated   = 1.05618134 * 0.999 = 1.05512516 -> +5.5125%
  const closeToCloseRep = evaluateBaselinePredictions(deterministicSeries, {
    executionBasis: 'CLOSE_TO_CLOSE',
    transactionCostBpsPerTurn: 10,
    allowShortSelling: true,
  });
  assert.equal(closeToCloseRep.totalTurnoverUnits, 5.0);
  assert.equal(closeToCloseRep.cumulativeReturnGrossPct, 6.1416);
  assert.equal(closeToCloseRep.cumulativeReturnNetPct, 5.6181);
  assert.equal(closeToCloseRep.cumulativeReturnNetLiquidatedPct, 5.5125);
});

test('[STAGE 4C.C REPRODUCIBILITY, HOLDOUT ISOLATION & CI FORMULAS] Verifies deterministic reproducibility, strict holdout isolation, horizon purging across H=1,3,5, and exact Wilson/Lo/Newey-West CI formulas', () => {
  // 1. Deterministic reproducibility of walk-forward and final holdout metrics
  const seriesA = createDeterministicOfflineResearchFixture({
    symbol: 'INFY.NS',
    candleCount: 220,
    startYear: 2024,
    basePrice: 1550,
  });
  const seriesB = createDeterministicOfflineResearchFixture({
    symbol: 'INFY.NS',
    candleCount: 220,
    startYear: 2024,
    basePrice: 1550,
  });

  const dsA = buildHistoricalPredictionDataset(seriesA, {
    forecastHorizonSessions: 1,
    minLookbackCandles: 50,
    excludeUnverifiedCalendarDates: true,
  });
  const dsB = buildHistoricalPredictionDataset(seriesB, {
    forecastHorizonSessions: 1,
    minLookbackCandles: 50,
    excludeUnverifiedCalendarDates: true,
  });

  const wfA = runExpandingWalkForwardValidation(dsA.usableObservations, {
    numFolds: 4,
    minInitialTrainRatio: 0.4,
    holdoutTestRatio: 0.15,
    allowShortSelling: false,
    executionBasis: 'INTRADAY_NEXT_OPEN_TO_CLOSE',
    useRealisticIndianCostPreset: true,
  });
  const wfB = runExpandingWalkForwardValidation(dsB.usableObservations, {
    numFolds: 4,
    minInitialTrainRatio: 0.4,
    holdoutTestRatio: 0.15,
    allowShortSelling: false,
    executionBasis: 'INTRADAY_NEXT_OPEN_TO_CLOSE',
    useRealisticIndianCostPreset: true,
  });

  assert.deepEqual(
    wfA.pooledWalkForwardComparison.ruleBasedBaseline.metrics,
    wfB.pooledWalkForwardComparison.ruleBasedBaseline.metrics
  );
  assert.deepEqual(
    wfA.holdoutTestComparison.ruleBasedBaseline.metrics,
    wfB.holdoutTestComparison.ruleBasedBaseline.metrics
  );

  // 2. Prove final holdout partition is completely isolated from fold preprocessors and holdoutTestPreprocessor
  const holdoutMinTs =
    wfA.holdoutTestComparison.ruleBasedBaseline.predictions[0].predictionTimestamp;
  assert.ok(wfA.holdoutTestPreprocessor.fitMaxTimestamp < holdoutMinTs);
  for (const fold of wfA.folds) {
    assert.ok(fold.preprocessor.fitMaxTimestamp < fold.validationMinTimestamp);
    assert.ok(fold.validationMaxTimestamp < holdoutMinTs);
  }

  // Corrupt ONLY the holdout partition with +99,999,999 feature values and verify holdoutTestPreprocessor and all walk-forward folds are 100% unchanged
  const holdoutCorruptedObs = dsA.usableObservations.map((obs) => {
    if (obs.timestamp < holdoutMinTs) return obs;
    const corruptedFeatures = { ...obs.features };
    for (const k of FEATURE_NAMES) corruptedFeatures[k] = 99_999_999;
    return {
      ...obs,
      features: corruptedFeatures,
      featureValues: FEATURE_NAMES.map((k) => corruptedFeatures[k]),
    };
  });
  const wfHoldoutCorrupted = runExpandingWalkForwardValidation(holdoutCorruptedObs, {
    numFolds: 4,
    minInitialTrainRatio: 0.4,
    holdoutTestRatio: 0.15,
    allowShortSelling: false,
    executionBasis: 'INTRADAY_NEXT_OPEN_TO_CLOSE',
    useRealisticIndianCostPreset: true,
  });
  assert.deepEqual(wfA.holdoutTestPreprocessor, wfHoldoutCorrupted.holdoutTestPreprocessor);
  assert.deepEqual(
    wfA.pooledWalkForwardComparison.ruleBasedBaseline.metrics,
    wfHoldoutCorrupted.pooledWalkForwardComparison.ruleBasedBaseline.metrics
  );

  // 3. Verify horizon boundary purging matches configured horizon H = 1, 3, 5
  for (const h of [1, 3, 5]) {
    const dsH = buildHistoricalPredictionDataset(seriesA, {
      forecastHorizonSessions: h,
      minLookbackCandles: 50,
    });
    const wfH = runExpandingWalkForwardValidation(dsH.usableObservations, {
      numFolds: 4,
      minInitialTrainRatio: 0.4,
      holdoutTestRatio: 0.15,
    });
    assert.equal(wfH.holdoutPurgedBoundaryCount, h);
    for (const fold of wfH.folds) {
      assert.equal(fold.purgedBoundaryRecordCount, h);
      for (const tr of fold.trainObservations) {
        assert.ok(tr.targetTimestamp < fold.validationMinTimestamp);
      }
    }
  }
});




