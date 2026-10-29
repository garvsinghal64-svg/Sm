/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  splitChronologically,
  isChronologicallyOrdered,
  verifyNoLookaheadLeakage,
  verifyNoWindowOverlap,
  hasRowMissingObservation,
  assertTemporalIntegrity,
  TimeSeriesRecord,
} from './dataLeakageAudit.ts';

test('[DATA-LEAKAGE] isChronologicallyOrdered verifies strict ascending timestamp sequence', () => {
  const ordered: TimeSeriesRecord[] = [
    { timestamp: 1000, close: 100 },
    { timestamp: 2000, close: 102 },
    { timestamp: 3000, close: 101 },
  ];
  assert.equal(isChronologicallyOrdered(ordered), true);

  const unordered: TimeSeriesRecord[] = [
    { timestamp: 1000, close: 100 },
    { timestamp: 3000, close: 101 },
    { timestamp: 2000, close: 102 },
  ];
  assert.equal(isChronologicallyOrdered(unordered), false);

  const duplicates: TimeSeriesRecord[] = [
    { timestamp: 1000, close: 100 },
    { timestamp: 1000, close: 102 },
  ];
  assert.equal(isChronologicallyOrdered(duplicates), false);

  const invalidTs: TimeSeriesRecord[] = [
    { timestamp: NaN, close: 100 },
    { timestamp: 2000, close: 102 },
  ];
  assert.equal(isChronologicallyOrdered(invalidTs), false);
});

test('[DATA-LEAKAGE] splitChronologically creates disjoint temporal partitions with zero overlap', () => {
  const records: TimeSeriesRecord[] = Array.from({ length: 100 }, (_, i) => ({
    timestamp: 1700000000 + i * 86400,
    price: 100 + i,
  }));

  const split = splitChronologically(records, 0.7, 0.15, 0.15);

  assert.equal(split.train.length, 70);
  assert.equal(split.validation.length, 15);
  assert.equal(split.test.length, 15);
  assert.equal(split.isStrictlyChronological, true);
  assert.equal(split.hasOverlappingWindows, false);
  assert.equal(split.hasMissingObservations, false);

  const maxTrain = split.train[split.train.length - 1].timestamp;
  const minVal = split.validation[0].timestamp;
  assert.ok(maxTrain < minVal, `Train max (${maxTrain}) must be < Validation min (${minVal})`);

  const maxVal = split.validation[split.validation.length - 1].timestamp;
  const minTest = split.test[0].timestamp;
  assert.ok(maxVal < minTest, `Validation max (${maxVal}) must be < Test min (${minTest})`);
});

test('[DATA-LEAKAGE] splitChronologically strictly enforces and rejects shuffled, out-of-order, or duplicate rows', () => {
  const shuffledRecords: TimeSeriesRecord[] = [
    { timestamp: 1700086400, price: 101 },
    { timestamp: 1700000000, price: 100 },
    { timestamp: 1700172800, price: 102 },
  ];

  assert.throws(() => {
    splitChronologically(shuffledRecords, 0.7, 0.15, 0.15);
  }, /Chronological order violation/);

  const duplicateBoundaryRecords: TimeSeriesRecord[] = [
    { timestamp: 1700000000, price: 100 },
    { timestamp: 1700086400, price: 101 },
    { timestamp: 1700086400, price: 102 },
    { timestamp: 1700172800, price: 103 },
  ];

  assert.throws(() => {
    splitChronologically(duplicateBoundaryRecords, 0.5, 0.25, 0.25);
  }, /Chronological order violation/);
});

test('[DATA-LEAKAGE] Overlapping windows: detects forward target horizon and rolling feature window overlap across split boundaries', () => {
  const recordsWithOverlappingWindows: TimeSeriesRecord[] = Array.from({ length: 10 }, (_, i) => {
    const ts = (i + 1) * 100;
    return {
      timestamp: ts,
      windowStartTimestamp: ts - 200,
      windowEndTimestamp: ts,
      targetTimestamp: ts + 300,
    };
  });

  const split = splitChronologically(recordsWithOverlappingWindows, 0.7, 0.1, 0.2);
  assert.equal(split.hasOverlappingWindows, true);
  assert.ok(split.overlappingBoundaryTimestamps.length > 0);

  const overlapReport = verifyNoWindowOverlap(split.train, split.validation, split.test);
  assert.equal(overlapReport.hasOverlap, true);
  assert.ok(
    overlapReport.overlappingTargetTimestamps.includes(700),
    'Train row at t=700 has targetTimestamp=1000 overlapping validation start t=800'
  );
  assert.ok(
    overlapReport.overlappingFeatureWindowTimestamps.includes(800),
    'Validation row at t=800 has windowStartTimestamp=600 overlapping train cutoff t=700'
  );
});

test('[DATA-LEAKAGE] Stage 3.3 Multi-day targets: detects, rejects, or purges multi-day target trajectories crossing train/val/test boundaries', () => {
  const dayMs = 86400 * 1000;
  // 20 daily observations: each row predicts a 3-day ahead trajectory [t+1d, t+2d, t+3d]
  const multiDayRecords: TimeSeriesRecord[] = Array.from({ length: 20 }, (_, i) => {
    const ts = 1700000000000 + (i + 1) * dayMs;
    return {
      timestamp: ts,
      close: 1000 + i * 10,
      windowStartTimestamp: ts - dayMs, // 2-day feature window [t-1d, t]
      windowEndTimestamp: ts,
      targetTimestamp: ts + 3 * dayMs,
      targetWindowTimestamps: [ts + dayMs, ts + 2 * dayMs, ts + 3 * dayMs],
      targetValues: [1010 + i * 10, 1020 + i * 10, 1030 + i * 10],
    };
  });

  // 1. Default split flags the multi-day target overlap at the end of train and validation
  const rawSplit = splitChronologically(multiDayRecords, 0.6, 0.2, 0.2);
  assert.equal(rawSplit.hasOverlappingWindows, true);

  // 2. With rejectOverlappingWindows: true, splitChronologically throws an explicit error
  assert.throws(() => {
    splitChronologically(multiDayRecords, 0.6, 0.2, 0.2, { rejectOverlappingWindows: true });
  }, /Boundary window overlap violation/);

  // 3. With purgeBoundaryOverlaps: true, overlapping boundary rows are purged so partitions are 100% isolated
  const purgedSplit = splitChronologically(multiDayRecords, 0.6, 0.2, 0.2, {
    purgeBoundaryOverlaps: true,
    rejectOverlappingWindows: true,
  });
  assert.equal(purgedSplit.hasOverlappingWindows, false);
  assert.ok(purgedSplit.purgedRecordCount > 0, 'Must purge boundary-crossing rows');
  const postPurgeCheck = verifyNoWindowOverlap(
    purgedSplit.train,
    purgedSplit.validation,
    purgedSplit.test
  );
  assert.equal(postPurgeCheck.hasOverlap, false);
});

test('[DATA-LEAKAGE] Stage 3.3 Missing observations: detects and rejects/purges null or NaN observations in prices, features, and multi-day targets', () => {
  assert.equal(hasRowMissingObservation({ timestamp: 1000, close: 250, featureValues: [248, 250], targetValue: 255 }), false);
  assert.equal(hasRowMissingObservation({ timestamp: 1000, isMissing: true, close: 250 }), true);
  assert.equal(hasRowMissingObservation({ timestamp: 1000, close: null }), true);
  assert.equal(hasRowMissingObservation({ timestamp: 1000, close: 250, featureValues: [248, null] }), true);
  assert.equal(hasRowMissingObservation({ timestamp: 1000, close: 250, targetValue: null }), true);
  assert.equal(hasRowMissingObservation({ timestamp: 1000, close: 250, targetValues: [252, NaN] }), true);

  const recordsWithMissing: TimeSeriesRecord[] = [
    { timestamp: 1000, close: 100, featureValues: [99, 100], targetValue: 101 },
    { timestamp: 2000, close: null, isMissing: true, featureValues: [100, null], targetValue: 102 }, // missing candle
    { timestamp: 3000, close: 102, featureValues: [null, 102], targetValue: 103 }, // missing feature in lookback window
    { timestamp: 4000, close: 103, featureValues: [102, 103], targetValue: null }, // missing future target
    { timestamp: 5000, close: 104, featureValues: [103, 104], targetValue: 105 },
  ];

  const split = splitChronologically(recordsWithMissing, 0.6, 0.2, 0.2);
  assert.equal(split.hasMissingObservations, true);
  assert.deepEqual(split.missingObservationTimestamps, [2000, 3000, 4000]);

  // Rejecting missing observations throws an error
  assert.throws(() => {
    splitChronologically(recordsWithMissing, 0.6, 0.2, 0.2, { rejectMissingObservations: true });
  }, /Missing observation violation/);

  // Purging removes all rows with missing observations
  const purged = splitChronologically(recordsWithMissing, 0.6, 0.2, 0.2, {
    purgeBoundaryOverlaps: true,
    rejectMissingObservations: true,
  });
  assert.equal(purged.hasMissingObservations, false);
  assert.equal(purged.totalRecords, 2);
});

test('[DATA-LEAKAGE] Boundary timestamps: exact cutoff equality vs +1ms lookahead in verifyNoLookaheadLeakage and assertTemporalIntegrity', () => {
  const cutoff = 1729000000000;

  const boundaryFeatures = [cutoff - 86400000, cutoff];
  const checkBoundaryValid = verifyNoLookaheadLeakage(boundaryFeatures, cutoff);
  assert.equal(checkBoundaryValid.hasLeakage, false);
  assert.equal(checkBoundaryValid.leakedTimestamps.length, 0);

  const checkPlusOneMs = verifyNoLookaheadLeakage([cutoff, cutoff + 1], cutoff);
  assert.equal(checkPlusOneMs.hasLeakage, true);
  assert.deepEqual(checkPlusOneMs.leakedTimestamps, [cutoff + 1]);
  assert.equal(checkPlusOneMs.earliestLeakedTimestamp, cutoff + 1);

  assert.equal(assertTemporalIntegrity(cutoff, cutoff + 1, cutoff), true);

  assert.throws(() => {
    assertTemporalIntegrity(cutoff + 1, cutoff + 86400000, cutoff);
  }, /Lookahead data leakage/);

  assert.throws(() => {
    assertTemporalIntegrity(cutoff, cutoff, cutoff);
  }, /Target timeline error/);

  assert.throws(() => {
    assertTemporalIntegrity(cutoff, cutoff - 1, cutoff);
  }, /Target timeline error/);
});
