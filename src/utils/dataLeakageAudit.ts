/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Data Leakage Prevention Engine for Financial Time-Series
 * Enforces strict temporal partitioning, rejecting unordered/shuffled inputs,
 * duplicate timestamps, forward lookahead bias, overlapping multi-day targets
 * or rolling feature windows across split boundaries, and missing observations.
 *
 * DOCUMENTED ARCHITECTURAL LIMITATIONS:
 * 1. Metadata-Dependent Window & Target Verification:
 *    verifyNoLookaheadLeakage and verifyNoWindowOverlap inspect the timestamps and
 *    feature/target arrays attached to each TimeSeriesRecord. If an external caller
 *    computes full-sample statistics (e.g. global mean/variance z-score scaling or
 *    PCA across the full dataset prior to splitting) without recording the full-sample
 *    windowEndTimestamp on the record, timestamp auditing alone cannot detect global
 *    scaler leakage; scalers must be fit strictly on the train partition.
 * 2. Retroactive Split Adjustment & Constituents:
 *    Historical Yahoo Finance quote[0] series are retroactively split-adjusted, and
 *    selecting current index constituents carries survivorship bias that chronological
 *    splitting alone does not eliminate.
 */

export interface TimeSeriesRecord {
  timestamp: number;
  windowStartTimestamp?: number;
  windowEndTimestamp?: number;
  targetTimestamp?: number;
  targetWindowTimestamps?: number[];
  isMissing?: boolean;
  hasMissingObservation?: boolean;
  close?: number | null;
  targetValue?: number | null;
  featureValues?: (number | null)[];
  targetValues?: (number | null)[];
  [key: string]: any;
}

export interface ChronologicalSplitOptions {
  rejectOverlappingWindows?: boolean;
  rejectMissingObservations?: boolean;
  purgeBoundaryOverlaps?: boolean;
}

export interface ChronologicalSplitResult<T extends TimeSeriesRecord> {
  train: T[];
  validation: T[];
  test: T[];
  trainCutoffTimestamp: number;
  valCutoffTimestamp: number;
  isStrictlyChronological: boolean;
  hasOverlappingWindows: boolean;
  overlappingBoundaryTimestamps: number[];
  hasMissingObservations: boolean;
  missingObservationTimestamps: number[];
  purgedRecordCount: number;
  totalRecords: number;
}

export interface LeakageCheckResult {
  hasLeakage: boolean;
  leakedTimestamps: number[];
  earliestLeakedTimestamp: number | null;
  cutoffTimestamp: number;
}

export interface WindowOverlapCheckResult {
  hasOverlap: boolean;
  overlappingTargetTimestamps: number[];
  overlappingFeatureWindowTimestamps: number[];
  missingObservationTimestamps: number[];
  boundaryViolations: string[];
}

/**
 * Detects whether a time-series record contains any missing/null/NaN observation
 * in its price, rolling feature window, or multi-day target horizon.
 */
export function hasRowMissingObservation<T extends TimeSeriesRecord>(row: T): boolean {
  if (!row || typeof row !== 'object') return true;
  if (row.isMissing === true || row.hasMissingObservation === true) return true;

  if ('close' in row && row.close !== undefined) {
    if (row.close === null || typeof row.close !== 'number' || !Number.isFinite(row.close) || row.close <= 0) {
      return true;
    }
  }

  if ('targetValue' in row && row.targetValue !== undefined) {
    if (row.targetValue === null || typeof row.targetValue !== 'number' || !Number.isFinite(row.targetValue)) {
      return true;
    }
  }

  if (Array.isArray(row.featureValues)) {
    for (const v of row.featureValues) {
      if (v === null || v === undefined || typeof v !== 'number' || !Number.isFinite(v)) {
        return true;
      }
    }
  }

  if (Array.isArray(row.targetValues)) {
    for (const v of row.targetValues) {
      if (v === null || v === undefined || typeof v !== 'number' || !Number.isFinite(v)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Validates that an array of records has valid finite timestamps and is strictly ascending.
 * Any out-of-order (shuffled) row or duplicate timestamp returns false.
 */
export function isChronologicallyOrdered<T extends TimeSeriesRecord>(records: T[]): boolean {
  if (!Array.isArray(records)) return false;
  if (records.length === 0) return true;

  for (let i = 0; i < records.length; i++) {
    const ts = records[i]?.timestamp;
    if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) {
      return false;
    }
    if (i > 0 && ts <= records[i - 1].timestamp) {
      return false;
    }
  }
  return true;
}

/**
 * Verifies whether train, validation, and test partitions have overlapping forward target horizons
 * (including multi-day target trajectories), rolling feature windows crossing partition boundaries,
 * or missing observations.
 */
export function verifyNoWindowOverlap<T extends TimeSeriesRecord>(
  train: T[],
  validation: T[],
  test: T[]
): WindowOverlapCheckResult {
  const overlappingTargetTimestamps: number[] = [];
  const overlappingFeatureWindowTimestamps: number[] = [];
  const missingObservationTimestamps: number[] = [];
  const boundaryViolations: string[] = [];

  const valStartTs =
    validation.length > 0 ? validation[0].timestamp : test.length > 0 ? test[0].timestamp : Infinity;
  const testStartTs = test.length > 0 ? test[0].timestamp : Infinity;
  const trainMaxTs = train.length > 0 ? train[train.length - 1].timestamp : -Infinity;
  const valMaxTs = validation.length > 0 ? validation[validation.length - 1].timestamp : trainMaxTs;

  const getMaxTargetTs = (row: T): number | undefined => {
    const candidates: number[] = [];
    if (typeof row.targetTimestamp === 'number' && Number.isFinite(row.targetTimestamp)) {
      candidates.push(row.targetTimestamp);
    }
    if (Array.isArray(row.targetWindowTimestamps)) {
      for (const t of row.targetWindowTimestamps) {
        if (typeof t === 'number' && Number.isFinite(t)) candidates.push(t);
      }
    }
    return candidates.length > 0 ? Math.max(...candidates) : undefined;
  };

  const getMinTargetTs = (row: T): number | undefined => {
    const candidates: number[] = [];
    if (typeof row.targetTimestamp === 'number' && Number.isFinite(row.targetTimestamp)) {
      candidates.push(row.targetTimestamp);
    }
    if (Array.isArray(row.targetWindowTimestamps)) {
      for (const t of row.targetWindowTimestamps) {
        if (typeof t === 'number' && Number.isFinite(t)) candidates.push(t);
      }
    }
    return candidates.length > 0 ? Math.min(...candidates) : undefined;
  };

  // 1. Check train records for multi-day target horizons leaking into validation/test
  for (const row of train) {
    if (hasRowMissingObservation(row)) {
      missingObservationTimestamps.push(row.timestamp);
    }
    if (row.windowEndTimestamp !== undefined && row.windowEndTimestamp > row.timestamp) {
      overlappingFeatureWindowTimestamps.push(row.timestamp);
      boundaryViolations.push(
        `Train row at ${row.timestamp} has feature windowEndTimestamp (${row.windowEndTimestamp}) > observation timestamp`
      );
    }
    const minTarget = getMinTargetTs(row);
    const maxTarget = getMaxTargetTs(row);
    if (minTarget !== undefined && minTarget <= row.timestamp) {
      boundaryViolations.push(
        `Train row at ${row.timestamp} has non-future targetTimestamp (${minTarget})`
      );
    }
    if (maxTarget !== undefined && maxTarget >= valStartTs) {
      overlappingTargetTimestamps.push(row.timestamp);
      boundaryViolations.push(
        `Train row at ${row.timestamp} has targetTimestamp (${maxTarget}) crossing next partition start (${valStartTs})`
      );
    }
  }

  // 2. Check validation records for feature windows overlapping train or multi-day targets leaking into test
  for (const row of validation) {
    if (hasRowMissingObservation(row)) {
      missingObservationTimestamps.push(row.timestamp);
    }
    if (row.windowEndTimestamp !== undefined && row.windowEndTimestamp > row.timestamp) {
      overlappingFeatureWindowTimestamps.push(row.timestamp);
      boundaryViolations.push(
        `Validation row at ${row.timestamp} has feature windowEndTimestamp (${row.windowEndTimestamp}) > observation timestamp`
      );
    }
    if (row.windowStartTimestamp !== undefined && row.windowStartTimestamp <= trainMaxTs) {
      overlappingFeatureWindowTimestamps.push(row.timestamp);
      boundaryViolations.push(
        `Validation row at ${row.timestamp} has feature windowStartTimestamp (${row.windowStartTimestamp}) overlapping train cutoff (${trainMaxTs})`
      );
    }
    const minTarget = getMinTargetTs(row);
    const maxTarget = getMaxTargetTs(row);
    if (minTarget !== undefined && minTarget <= row.timestamp) {
      boundaryViolations.push(
        `Validation row at ${row.timestamp} has non-future targetTimestamp (${minTarget})`
      );
    }
    if (maxTarget !== undefined && maxTarget >= testStartTs) {
      overlappingTargetTimestamps.push(row.timestamp);
      boundaryViolations.push(
        `Validation row at ${row.timestamp} has targetTimestamp (${maxTarget}) crossing test start (${testStartTs})`
      );
    }
  }

  // 3. Check test records for feature windows overlapping validation/train
  for (const row of test) {
    if (hasRowMissingObservation(row)) {
      missingObservationTimestamps.push(row.timestamp);
    }
    if (row.windowEndTimestamp !== undefined && row.windowEndTimestamp > row.timestamp) {
      overlappingFeatureWindowTimestamps.push(row.timestamp);
      boundaryViolations.push(
        `Test row at ${row.timestamp} has feature windowEndTimestamp (${row.windowEndTimestamp}) > observation timestamp`
      );
    }
    if (row.windowStartTimestamp !== undefined && row.windowStartTimestamp <= valMaxTs) {
      overlappingFeatureWindowTimestamps.push(row.timestamp);
      boundaryViolations.push(
        `Test row at ${row.timestamp} has feature windowStartTimestamp (${row.windowStartTimestamp}) overlapping validation cutoff (${valMaxTs})`
      );
    }
    const minTarget = getMinTargetTs(row);
    if (minTarget !== undefined && minTarget <= row.timestamp) {
      boundaryViolations.push(
        `Test row at ${row.timestamp} has non-future targetTimestamp (${minTarget})`
      );
    }
  }

  return {
    hasOverlap: boundaryViolations.length > 0,
    overlappingTargetTimestamps,
    overlappingFeatureWindowTimestamps,
    missingObservationTimestamps,
    boundaryViolations,
  };
}

/**
 * Partitions time-series data chronologically.
 * Strictly enforces that input records are already ordered in strictly ascending timestamp sequence:
 * throws an Error if rows were randomly shuffled, out-of-order, or contain duplicate timestamps.
 * Supports optional boundary-overlap purging/rejection and missing-observation rejection.
 */
export function splitChronologically<T extends TimeSeriesRecord>(
  records: T[],
  trainRatio: number = 0.7,
  valRatio: number = 0.15,
  testRatio: number = 0.15,
  options: ChronologicalSplitOptions = {}
): ChronologicalSplitResult<T> {
  if (!Array.isArray(records) || records.length === 0) {
    return {
      train: [],
      validation: [],
      test: [],
      trainCutoffTimestamp: 0,
      valCutoffTimestamp: 0,
      isStrictlyChronological: true,
      hasOverlappingWindows: false,
      overlappingBoundaryTimestamps: [],
      hasMissingObservations: false,
      missingObservationTimestamps: [],
      purgedRecordCount: 0,
      totalRecords: 0,
    };
  }

  if (trainRatio < 0 || valRatio < 0 || testRatio < 0) {
    throw new Error('Split ratios must be non-negative');
  }

  const ratioSum = trainRatio + valRatio + testRatio;
  if (Math.abs(ratioSum - 1.0) > 0.001) {
    throw new Error(`Split ratios must sum to 1.0 (received ${ratioSum.toFixed(3)})`);
  }

  // Enforce strict chronological ordering on input: reject shuffled, out-of-order, or duplicate timestamps
  if (!isChronologicallyOrdered(records)) {
    throw new Error(
      'Chronological order violation: input records are unordered, randomly shuffled, or contain duplicate/invalid timestamps.'
    );
  }

  // Validate per-row feature and target timestamps if present
  for (const row of records) {
    if (row.windowEndTimestamp !== undefined && row.windowEndTimestamp > row.timestamp) {
      throw new Error(
        `Lookahead feature window error: row at ${row.timestamp} uses feature data from ${row.windowEndTimestamp}`
      );
    }
    if (row.targetTimestamp !== undefined && row.targetTimestamp <= row.timestamp) {
      throw new Error(
        `Target timeline error: row at ${row.timestamp} has non-future targetTimestamp ${row.targetTimestamp}`
      );
    }
    if (Array.isArray(row.targetWindowTimestamps)) {
      for (const tts of row.targetWindowTimestamps) {
        if (tts <= row.timestamp) {
          throw new Error(
            `Target timeline error: row at ${row.timestamp} has non-future targetWindowTimestamp ${tts}`
          );
        }
      }
    }
  }

  const n = records.length;
  const nTrain = Math.floor(n * trainRatio);
  const nVal = Math.floor(n * valRatio);

  let train = records.slice(0, nTrain);
  let validation = records.slice(nTrain, nTrain + nVal);
  let test = records.slice(nTrain + nVal);
  let purgedRecordCount = 0;

  if (options.purgeBoundaryOverlaps) {
    // Exclude rows with missing observations first
    const cleanTrain = train.filter((r) => !hasRowMissingObservation(r));
    const cleanVal = validation.filter((r) => !hasRowMissingObservation(r));
    const cleanTest = test.filter((r) => !hasRowMissingObservation(r));

    const valStartTs =
      cleanVal.length > 0 ? cleanVal[0].timestamp : cleanTest.length > 0 ? cleanTest[0].timestamp : Infinity;
    const testStartTs = cleanTest.length > 0 ? cleanTest[0].timestamp : Infinity;

    // Embargo train rows whose multi-day target crosses into validation/test
    const purgedTrain = cleanTrain.filter((r) => {
      const maxT = Math.max(
        r.targetTimestamp ?? -Infinity,
        ...(Array.isArray(r.targetWindowTimestamps) ? r.targetWindowTimestamps : [-Infinity])
      );
      return maxT < valStartTs;
    });

    const trainMaxTs = purgedTrain.length > 0 ? purgedTrain[purgedTrain.length - 1].timestamp : -Infinity;

    // Embargo validation rows whose feature window overlaps train or whose target crosses into test
    const purgedVal = cleanVal.filter((r) => {
      if (r.windowStartTimestamp !== undefined && r.windowStartTimestamp <= trainMaxTs) return false;
      const maxT = Math.max(
        r.targetTimestamp ?? -Infinity,
        ...(Array.isArray(r.targetWindowTimestamps) ? r.targetWindowTimestamps : [-Infinity])
      );
      return maxT < testStartTs;
    });

    const valMaxTs = purgedVal.length > 0 ? purgedVal[purgedVal.length - 1].timestamp : trainMaxTs;

    // Embargo test rows whose feature window overlaps validation/train
    const purgedTest = cleanTest.filter((r) => {
      if (r.windowStartTimestamp !== undefined && r.windowStartTimestamp <= valMaxTs) return false;
      return true;
    });

    purgedRecordCount = n - (purgedTrain.length + purgedVal.length + purgedTest.length);
    train = purgedTrain;
    validation = purgedVal;
    test = purgedTest;
  }

  const trainCutoffTimestamp = train.length > 0 ? train[train.length - 1].timestamp : 0;
  const valCutoffTimestamp =
    validation.length > 0 ? validation[validation.length - 1].timestamp : trainCutoffTimestamp;

  // Strict temporal boundary assertion
  let isStrictlyChronological = true;
  if (train.length > 0 && validation.length > 0) {
    if (train[train.length - 1].timestamp >= validation[0].timestamp) {
      isStrictlyChronological = false;
    }
  }
  if (validation.length > 0 && test.length > 0) {
    if (validation[validation.length - 1].timestamp >= test[0].timestamp) {
      isStrictlyChronological = false;
    }
  }
  if (train.length > 0 && validation.length === 0 && test.length > 0) {
    if (train[train.length - 1].timestamp >= test[0].timestamp) {
      isStrictlyChronological = false;
    }
  }

  const overlapCheck = verifyNoWindowOverlap(train, validation, test);
  const overlappingBoundaryTimestamps = [
    ...overlapCheck.overlappingTargetTimestamps,
    ...overlapCheck.overlappingFeatureWindowTimestamps,
  ];

  if (options.rejectMissingObservations && overlapCheck.missingObservationTimestamps.length > 0) {
    throw new Error(
      `Missing observation violation: ${overlapCheck.missingObservationTimestamps.length} record(s) contain null/NaN/missing observations at timestamps [${overlapCheck.missingObservationTimestamps.join(', ')}]`
    );
  }

  if (options.rejectOverlappingWindows && overlapCheck.hasOverlap) {
    throw new Error(
      `Boundary window overlap violation: ${overlapCheck.boundaryViolations.join('; ')}`
    );
  }

  return {
    train,
    validation,
    test,
    trainCutoffTimestamp,
    valCutoffTimestamp,
    isStrictlyChronological,
    hasOverlappingWindows: overlapCheck.hasOverlap,
    overlappingBoundaryTimestamps,
    hasMissingObservations: overlapCheck.missingObservationTimestamps.length > 0,
    missingObservationTimestamps: overlapCheck.missingObservationTimestamps,
    purgedRecordCount,
    totalRecords: train.length + validation.length + test.length,
  };
}

/**
 * Verifies that no feature in a dataset contains timestamps exceeding the prediction cutoff.
 * A feature timestamp exactly equal to predictionCutoffTimestamp (t === cutoff) is permitted;
 * any feature timestamp strictly greater than predictionCutoffTimestamp (t > cutoff) or non-finite is flagged.
 */
export function verifyNoLookaheadLeakage(
  featureTimestamps: number[],
  predictionCutoffTimestamp: number
): LeakageCheckResult {
  if (typeof predictionCutoffTimestamp !== 'number' || !Number.isFinite(predictionCutoffTimestamp)) {
    throw new Error('Invalid predictionCutoffTimestamp provided to verifyNoLookaheadLeakage');
  }

  const leakedTimestamps: number[] = [];
  for (const t of featureTimestamps) {
    if (typeof t !== 'number' || !Number.isFinite(t)) {
      throw new Error(`Invalid feature timestamp (${t}) in verifyNoLookaheadLeakage`);
    }
    if (t > predictionCutoffTimestamp) {
      leakedTimestamps.push(t);
    }
  }

  return {
    hasLeakage: leakedTimestamps.length > 0,
    leakedTimestamps,
    earliestLeakedTimestamp: leakedTimestamps.length > 0 ? Math.min(...leakedTimestamps) : null,
    cutoffTimestamp: predictionCutoffTimestamp,
  };
}

/**
 * Validates a supervised learning dataset row:
 * Asserts that the feature timestamp t <= predictionCutoff, while target is strictly t + targetHorizon (target > feature).
 */
export function assertTemporalIntegrity(
  featureObservationTimestamp: number,
  targetObservationTimestamp: number,
  predictionCutoff: number
): boolean {
  if (
    !Number.isFinite(featureObservationTimestamp) ||
    !Number.isFinite(targetObservationTimestamp) ||
    !Number.isFinite(predictionCutoff)
  ) {
    throw new Error('Timestamps provided to assertTemporalIntegrity must be finite numbers');
  }

  if (featureObservationTimestamp > predictionCutoff) {
    throw new Error(
      `Lookahead data leakage: Feature observation timestamp (${featureObservationTimestamp}) is after predictionCutoff (${predictionCutoff})`
    );
  }
  if (targetObservationTimestamp <= featureObservationTimestamp) {
    throw new Error(
      `Target timeline error: Target observation timestamp (${targetObservationTimestamp}) must be strictly after feature timestamp (${featureObservationTimestamp})`
    );
  }
  return true;
}
