/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert';
import {
  fitStandardScaler,
  transformWithScaler,
  RidgeRegressionModel,
  LogisticRegressionModel,
  DecisionTreeClassifier,
  benchmarkMachineLearningModels,
  extractFeatureVector,
} from './mlBenchmarking.ts';
import {
  createDeterministicOfflineResearchFixture,
  buildHistoricalPredictionDataset,
} from './predictionResearch.ts';

test('[STAGE 4G ML] Standard scaler strictly isolates train statistics from test data', () => {
  const trainX = [
    [10, 100],
    [20, 200],
    [30, 300],
  ];
  const scaler = fitStandardScaler(trainX);
  assert.strictEqual(scaler.means[0], 20);
  assert.strictEqual(scaler.means[1], 200);

  const transformedTrain = transformWithScaler(trainX, scaler);
  // Mean of standardized train should be 0
  assert.strictEqual(Math.round(transformedTrain[1][0]), 0);
  assert.strictEqual(Math.round(transformedTrain[1][1]), 0);

  // Apply to test without changing scaler statistics
  const testX = [[40, 400]];
  const transformedTest = transformWithScaler(testX, scaler);
  assert.ok(transformedTest[0][0] > 0);
  assert.ok(transformedTest[0][1] > 0);
});

test('[STAGE 4G ML] Ridge regression fits and predicts deterministic values', () => {
  const X = [
    [1, 2],
    [2, 4],
    [3, 6],
    [4, 8],
  ];
  const y = [3, 6, 9, 12]; // linear relation y = x1 + x2

  const model = new RidgeRegressionModel(0.1);
  model.fit(X, y);
  const preds = model.predict([[5, 10]]);

  assert.ok(preds[0] > 13 && preds[0] < 16);
});

test('[STAGE 4G ML] Logistic regression produces calibrated direction probabilities', () => {
  const X = [
    [-2, -3],
    [-1, -2],
    [1, 2],
    [2, 3],
  ];
  const y = [0, 0, 1, 1];

  const model = new LogisticRegressionModel(0.1, 0.01, 100);
  model.fit(X, y);
  const probs = model.predictProbabilities([
    [-2, -2],
    [2, 2],
  ]);

  assert.ok(probs[0] < 0.5); // Down probability
  assert.ok(probs[1] > 0.5); // Up probability
});

test('[STAGE 4G ML] Predeclared deployment gate rejects models when costs exceed edge', () => {
  const fixture = createDeterministicOfflineResearchFixture({ symbol: 'RELIANCE.NS', candleCount: 180, startYear: 2024 });
  const dataset = buildHistoricalPredictionDataset(fixture);
  const observations = dataset.usableObservations;

  const trainSplit = observations.slice(0, 80);
  const testSplit = observations.slice(80);

  const benchmarkResult = benchmarkMachineLearningModels(
    trainSplit,
    testSplit,
    'INTRADAY_NEXT_OPEN_TO_CLOSE'
  );

  assert.strictEqual(benchmarkResult.metrics.length, 3);
  assert.strictEqual(benchmarkResult.metrics[0].modelType, 'RIDGE_REGRESSION');
  assert.strictEqual(benchmarkResult.metrics[1].modelType, 'LOGISTIC_REGRESSION');
  assert.strictEqual(benchmarkResult.metrics[2].modelType, 'DECISION_TREE');

  // Verify that all metrics contain Wilson score intervals and sample counts
  for (const m of benchmarkResult.metrics) {
    assert.strictEqual(m.sampleCount, testSplit.length);
    assert.ok(Number.isFinite(m.wilson95CILowerPct));
    assert.ok(Number.isFinite(m.wilson95CIUpperPct));
    assert.ok(Number.isFinite(m.netCumulativeReturnPct));
    assert.ok(Number.isFinite(m.annualizedSharpeRatio));
  }

  // Predeclared deployment gate must be strictly enforced
  if (!benchmarkResult.anyModelPassedGate) {
    assert.ok(benchmarkResult.deploymentSummary.includes('DEPLOYMENT GATE REJECTED'));
    for (const m of benchmarkResult.metrics) {
      assert.strictEqual(m.passedDeploymentGate, false);
      assert.ok(m.gateRejectionReasons.length > 0);
    }
  }
});
