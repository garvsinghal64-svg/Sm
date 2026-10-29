/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * STAGE 4G — MACHINE LEARNING BENCHMARKING & LEAKAGE-FREE EVALUATION ENGINE
 * =========================================================================
 * Transparent, pure-TypeScript ML benchmarking engine comparing:
 * - Ridge Regression (L2 regularized return prediction)
 * - Logistic Regression (L2 regularized direction classification)
 * - Decision Tree Classifier (Non-linear recursive partitioning)
 *
 * AGAINST verified baselines (No-Change, Return-Persistence, Rule-Based) under
 * identical walk-forward folds, horizon purging, fold-isolated preprocessing,
 * and side-specific statutory Indian transaction costs.
 *
 * Enforces a strict, predeclared DEPLOYMENT GATE:
 * No model is integrated into live scanners unless it demonstrates statistically
 * significant directional edge (Wilson 95% CI > 50%) and positive net alpha after costs.
 */

import {
  HistoricalPredictionDataset,
  PredictionResearchObservation,
  FeatureMap,
  FEATURE_NAMES,
  FeatureName,
  evaluateBaselinePredictions,
  BaselinePredictionPoint,
  getRealisticIndianMarketCostPreset,
} from './predictionResearch.ts';

export interface MLModelBenchmarkMetrics {
  modelName: string;
  modelType: 'BASELINE' | 'RIDGE_REGRESSION' | 'LOGISTIC_REGRESSION' | 'DECISION_TREE';
  sampleCount: number;
  maePct: number;
  rmsePct: number;
  directionalAccuracyPct: number;
  wilson95CILowerPct: number;
  wilson95CIUpperPct: number;
  grossCumulativeReturnPct: number;
  netCumulativeReturnPct: number;
  annualizedSharpeRatio: number;
  sharpeHAC95CILower: number;
  sharpeHAC95CIUpper: number;
  maxDrawdownPct: number;
  totalTurnoverUnits: number;
  totalFeesPaidPct: number;
  passedDeploymentGate: boolean;
  gateRejectionReasons: string[];
}

export interface MLDeploymentGateCriteria {
  minDirectionalAccuracyWilsonLowerPct: number; // e.g. 50.0%
  requirePositiveNetReturnAfterCosts: boolean;
  minSharpeRatio: number; // e.g. > 0.0
}

export const DEFAULT_DEPLOYMENT_GATE: MLDeploymentGateCriteria = {
  minDirectionalAccuracyWilsonLowerPct: 50.0,
  requirePositiveNetReturnAfterCosts: true,
  minSharpeRatio: 0.0,
};

// -------------------------------------------------------------------------
// PURE TYPESCRIPT MACHINE LEARNING IMPLEMENTATIONS
// -------------------------------------------------------------------------

/**
 * Standardizes a feature matrix X based on training-set mean and standard deviation.
 * Strictly prevents test-fold contamination.
 */
export interface FittedScaler {
  means: number[];
  stds: number[];
}

export function fitStandardScaler(X: number[][]): FittedScaler {
  const numFeatures = X[0]?.length || 0;
  const n = X.length;
  const means: number[] = new Array(numFeatures).fill(0);
  const stds: number[] = new Array(numFeatures).fill(1);

  if (n === 0) return { means, stds };

  for (let j = 0; j < numFeatures; j++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += X[i][j];
    means[j] = sum / n;

    let varSum = 0;
    for (let i = 0; i < n; i++) {
      const diff = X[i][j] - means[j];
      varSum += diff * diff;
    }
    const std = Math.sqrt(varSum / Math.max(1, n - 1));
    stds[j] = std > 1e-8 ? std : 1.0;
  }

  return { means, stds };
}

export function transformWithScaler(X: number[][], scaler: FittedScaler): number[][] {
  return X.map((row) =>
    row.map((val, j) => (val - scaler.means[j]) / scaler.stds[j])
  );
}

/**
 * Ridge Regression (L2 Regularized Linear Model)
 * Solves: w = (X^T X + lambda * I)^(-1) X^T y
 */
export class RidgeRegressionModel {
  public weights: number[] = [];
  public intercept: number = 0;

  constructor(public lambda: number = 10.0) {}

  public fit(X: number[][], y: number[]) {
    const n = X.length;
    const p = X[0]?.length || 0;
    if (n === 0 || p === 0) return;

    const meanX = new Array(p).fill(0);
    for (let j = 0; j < p; j++) {
      let sum = 0;
      for (let i = 0; i < n; i++) sum += X[i][j];
      meanX[j] = sum / n;
    }
    const XCentered = X.map((row) => row.map((v, j) => v - meanX[j]));

    const meanY = y.reduce((a, b) => a + b, 0) / n;
    const yCentered = y.map((v) => v - meanY);

    // Compute XCentered^T XCentered + lambda * I
    const XtX: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
    for (let i = 0; i < p; i++) {
      for (let j = 0; j < p; j++) {
        let dot = 0;
        for (let k = 0; k < n; k++) dot += XCentered[k][i] * XCentered[k][j];
        XtX[i][j] = dot;
      }
      XtX[i][i] += this.lambda;
    }

    // Compute XCentered^T yCentered
    const Xty: number[] = new Array(p).fill(0);
    for (let i = 0; i < p; i++) {
      let dot = 0;
      for (let k = 0; k < n; k++) dot += XCentered[k][i] * yCentered[k];
      Xty[i] = dot;
    }

    // Solve linear system via Gaussian elimination
    this.weights = this.solveLinearSystem(XtX, Xty);
    let dotMean = 0;
    for (let j = 0; j < p; j++) dotMean += (this.weights[j] || 0) * meanX[j];
    this.intercept = meanY - dotMean;
  }

  public predict(X: number[][]): number[] {
    return X.map((row) => {
      let sum = this.intercept;
      for (let j = 0; j < row.length; j++) {
        sum += row[j] * (this.weights[j] || 0);
      }
      return sum;
    });
  }

  private solveLinearSystem(A: number[][], b: number[]): number[] {
    const n = b.length;
    const M = A.map((row, i) => [...row, b[i]]);

    for (let i = 0; i < n; i++) {
      let maxEl = Math.abs(M[i][i]);
      let maxRow = i;
      for (let k = i + 1; k < n; k++) {
        if (Math.abs(M[k][i]) > maxEl) {
          maxEl = Math.abs(M[k][i]);
          maxRow = k;
        }
      }

      for (let k = i; k < n + 1; k++) {
        const tmp = M[maxRow][k];
        M[maxRow][k] = M[i][k];
        M[i][k] = tmp;
      }

      const pivot = M[i][i] || 1e-8;
      for (let k = i + 1; k < n; k++) {
        const c = -M[k][i] / pivot;
        for (let j = i; j < n + 1; j++) {
          if (i === j) M[k][j] = 0;
          else M[k][j] += c * M[i][j];
        }
      }
    }

    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
      const pivot = M[i][i] || 1e-8;
      x[i] = M[i][n] / pivot;
      for (let k = i - 1; k >= 0; k--) {
        M[k][n] -= M[k][i] * x[i];
      }
    }
    return x;
  }
}

/**
 * Logistic Regression (L2 Regularized Direction Classifier)
 * Probability p = 1 / (1 + exp(-(w^T x + b)))
 */
export class LogisticRegressionModel {
  public weights: number[] = [];
  public bias: number = 0;

  constructor(
    public learningRate: number = 0.05,
    public l2Penalty: number = 0.01,
    public epochs: number = 100
  ) {}

  public fit(X: number[][], yBinary: number[]) {
    const n = X.length;
    const p = X[0]?.length || 0;
    if (n === 0 || p === 0) return;

    this.weights = new Array(p).fill(0);
    this.bias = 0;

    for (let epoch = 0; epoch < this.epochs; epoch++) {
      const gradW = new Array(p).fill(0);
      let gradB = 0;

      for (let i = 0; i < n; i++) {
        let z = this.bias;
        for (let j = 0; j < p; j++) z += X[i][j] * this.weights[j];
        const pred = 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, z))));
        const error = pred - yBinary[i];

        for (let j = 0; j < p; j++) {
          gradW[j] += error * X[i][j];
        }
        gradB += error;
      }

      for (let j = 0; j < p; j++) {
        this.weights[j] -= this.learningRate * (gradW[j] / n + this.l2Penalty * this.weights[j]);
      }
      this.bias -= this.learningRate * (gradB / n);
    }
  }

  public predictProbabilities(X: number[][]): number[] {
    return X.map((row) => {
      let z = this.bias;
      for (let j = 0; j < row.length; j++) z += row[j] * this.weights[j];
      return 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, z))));
    });
  }

  public predictSigns(X: number[][]): number[] {
    const probs = this.predictProbabilities(X);
    return probs.map((p) => (p > 0.52 ? 1 : p < 0.48 ? -1 : 0));
  }
}

/**
 * Simple Non-Linear Decision Tree Stumps / Split Classifier
 */
export class DecisionTreeClassifier {
  public bestFeatureIndex: number = 0;
  public bestThreshold: number = 0;
  public leftPrediction: number = 0;
  public rightPrediction: number = 0;

  public fit(X: number[][], ySigns: number[]) {
    const n = X.length;
    const p = X[0]?.length || 0;
    if (n === 0 || p === 0) return;

    let bestGini = Infinity;

    // Search across top features (e.g. RSI, MACD, returns)
    for (let f = 0; f < p; f++) {
      const values = X.map((r) => r[f]);
      const thresholds = [
        values[Math.floor(n * 0.25)],
        values[Math.floor(n * 0.5)],
        values[Math.floor(n * 0.75)],
      ];

      for (const thresh of thresholds) {
        let leftUp = 0;
        let leftDown = 0;
        let rightUp = 0;
        let rightDown = 0;

        for (let i = 0; i < n; i++) {
          if (X[i][f] <= thresh) {
            if (ySigns[i] > 0) leftUp++;
            else leftDown++;
          } else {
            if (ySigns[i] > 0) rightUp++;
            else rightDown++;
          }
        }

        const leftTotal = leftUp + leftDown;
        const rightTotal = rightUp + rightDown;
        if (leftTotal === 0 || rightTotal === 0) continue;

        const leftGini = 1 - Math.pow(leftUp / leftTotal, 2) - Math.pow(leftDown / leftTotal, 2);
        const rightGini = 1 - Math.pow(rightUp / rightTotal, 2) - Math.pow(rightDown / rightTotal, 2);
        const weightedGini = (leftTotal / n) * leftGini + (rightTotal / n) * rightGini;

        if (weightedGini < bestGini) {
          bestGini = weightedGini;
          this.bestFeatureIndex = f;
          this.bestThreshold = thresh;
          this.leftPrediction = leftUp >= leftDown ? 1 : -1;
          this.rightPrediction = rightUp >= rightDown ? 1 : -1;
        }
      }
    }
  }

  public predictSigns(X: number[][]): number[] {
    return X.map((row) =>
      row[this.bestFeatureIndex] <= this.bestThreshold ? this.leftPrediction : this.rightPrediction
    );
  }
}

// -------------------------------------------------------------------------
// BENCHMARKING HARNESS & DEPLOYMENT GATE VERIFICATION
// -------------------------------------------------------------------------

/**
 * Extracts numeric feature vector from observation FeatureMap in deterministic order.
 */
export function extractFeatureVector(features: FeatureMap): number[] {
  return FEATURE_NAMES.map((name) => features[name] ?? 0);
}

/**
 * Trains and benchmarks Ridge, Logistic, and Decision Tree models on the walk-forward
 * training splits and evaluates them strictly on the sealed test/holdout split.
 */
export function benchmarkMachineLearningModels(
  trainObservations: PredictionResearchObservation[],
  testObservations: PredictionResearchObservation[],
  executionMode: 'INTRADAY_NEXT_OPEN_TO_CLOSE' | 'MULTI_DAY_POSITION' = 'INTRADAY_NEXT_OPEN_TO_CLOSE',
  gateCriteria: MLDeploymentGateCriteria = DEFAULT_DEPLOYMENT_GATE
): {
  metrics: MLModelBenchmarkMetrics[];
  anyModelPassedGate: boolean;
  deploymentSummary: string;
} {
  const costPreset = getRealisticIndianMarketCostPreset('CASH_EQUITY_INTRADAY_MIS');

  // Prepare train data
  const rawXTrain = trainObservations.map((o) => extractFeatureVector(o.features));
  const yTrainReturns = trainObservations.map((o) => o.targetReturnPct);
  const yTrainBinary = yTrainReturns.map((r) => (r > 0 ? 1 : 0));
  const yTrainSigns = yTrainReturns.map((r) => (r > 0 ? 1 : r < 0 ? -1 : 0));

  // Fit scaler strictly on train observations
  const scaler = fitStandardScaler(rawXTrain);
  const XTrain = transformWithScaler(rawXTrain, scaler);

  // Prepare test data using training scaler
  const rawXTest = testObservations.map((o) => extractFeatureVector(o.features));
  const XTest = transformWithScaler(rawXTest, scaler);

  const testActualReturns = testObservations.map((o) => o.targetReturnPct);

  // 1. Train Ridge Regression
  const ridge = new RidgeRegressionModel(10.0);
  ridge.fit(XTrain, yTrainReturns);
  const ridgePredReturns = ridge.predict(XTest);
  const ridgePoints: BaselinePredictionPoint[] = testObservations.map((obs, i) => {
    const predictedReturn = ridgePredReturns[i];
    const positionSignal: -1 | 0 | 1 = predictedReturn > 0.1 ? 1 : predictedReturn < -0.1 ? -1 : 0;
    return {
      symbol: obs.symbol,
      predictionTimestamp: obs.timestamp,
      predictionDateIST: obs.predictionDateIST,
      targetTimestamp: obs.targetTimestamp,
      targetDateIST: obs.targetDateIST,
      forecastHorizonSessions: obs.forecastHorizonSessions,
      currentClose: obs.currentClose,
      nextSessionOpen: obs.nextSessionOpen,
      actualTargetClose: obs.targetClose,
      actualReturnPct: obs.targetReturnPct,
      overnightGapReturnPct: obs.overnightGapReturnPct,
      openToTargetReturnPct: obs.openToTargetReturnPct,
      actualDirection: obs.targetDirection,
      predictedTargetClose: obs.currentClose * (1 + predictedReturn / 100),
      predictedReturnPct: predictedReturn,
      predictedDirection: predictedReturn > 0.05 ? 'UP' : predictedReturn < -0.05 ? 'DOWN' : 'FLAT',
      positionSignal,
      baselineModelName: 'Ridge Regression (L2)',
      ruleExplanation: 'L2 Regularized Linear Model on 9 technical features',
    };
  });
  const ridgeEval = evaluateBaselinePredictions(ridgePoints, {
    executionBasis: executionMode,
    allowShortSelling: true,
    useRealisticIndianCostPreset: true,
  });

  // 2. Train Logistic Regression
  const logistic = new LogisticRegressionModel(0.05, 0.01, 150);
  logistic.fit(XTrain, yTrainBinary);
  const logisticSigns = logistic.predictSigns(XTest);
  const logisticPoints: BaselinePredictionPoint[] = testObservations.map((obs, i) => {
    const positionSignal = logisticSigns[i] as -1 | 0 | 1;
    const predictedReturn = positionSignal * 0.5;
    return {
      symbol: obs.symbol,
      predictionTimestamp: obs.timestamp,
      predictionDateIST: obs.predictionDateIST,
      targetTimestamp: obs.targetTimestamp,
      targetDateIST: obs.targetDateIST,
      forecastHorizonSessions: obs.forecastHorizonSessions,
      currentClose: obs.currentClose,
      nextSessionOpen: obs.nextSessionOpen,
      actualTargetClose: obs.targetClose,
      actualReturnPct: obs.targetReturnPct,
      overnightGapReturnPct: obs.overnightGapReturnPct,
      openToTargetReturnPct: obs.openToTargetReturnPct,
      actualDirection: obs.targetDirection,
      predictedTargetClose: obs.currentClose * (1 + predictedReturn / 100),
      predictedReturnPct: predictedReturn,
      predictedDirection: positionSignal === 1 ? 'UP' : positionSignal === -1 ? 'DOWN' : 'FLAT',
      positionSignal,
      baselineModelName: 'Logistic Regression (L2)',
      ruleExplanation: 'L2 Regularized Logistic Classifier on 9 technical features',
    };
  });
  const logisticEval = evaluateBaselinePredictions(logisticPoints, {
    executionBasis: executionMode,
    allowShortSelling: true,
    useRealisticIndianCostPreset: true,
  });

  // 3. Train Decision Tree
  const tree = new DecisionTreeClassifier();
  tree.fit(XTrain, yTrainSigns);
  const treeSigns = tree.predictSigns(XTest);
  const treePoints: BaselinePredictionPoint[] = testObservations.map((obs, i) => {
    const positionSignal = treeSigns[i] as -1 | 0 | 1;
    const predictedReturn = positionSignal * 0.5;
    return {
      symbol: obs.symbol,
      predictionTimestamp: obs.timestamp,
      predictionDateIST: obs.predictionDateIST,
      targetTimestamp: obs.targetTimestamp,
      targetDateIST: obs.targetDateIST,
      forecastHorizonSessions: obs.forecastHorizonSessions,
      currentClose: obs.currentClose,
      nextSessionOpen: obs.nextSessionOpen,
      actualTargetClose: obs.targetClose,
      actualReturnPct: obs.targetReturnPct,
      overnightGapReturnPct: obs.overnightGapReturnPct,
      openToTargetReturnPct: obs.openToTargetReturnPct,
      actualDirection: obs.targetDirection,
      predictedTargetClose: obs.currentClose * (1 + predictedReturn / 100),
      predictedReturnPct: predictedReturn,
      predictedDirection: positionSignal === 1 ? 'UP' : positionSignal === -1 ? 'DOWN' : 'FLAT',
      positionSignal,
      baselineModelName: 'Decision Tree Classifier',
      ruleExplanation: 'Non-linear single-tree split on 9 technical features',
    };
  });
  const treeEval = evaluateBaselinePredictions(treePoints, {
    executionBasis: executionMode,
    allowShortSelling: true,
    useRealisticIndianCostPreset: true,
  });

  // Evaluate Deployment Gate for each model
  const models = [
    { name: 'Ridge Regression (L2)', type: 'RIDGE_REGRESSION' as const, evalResult: ridgeEval },
    { name: 'Logistic Regression (L2)', type: 'LOGISTIC_REGRESSION' as const, evalResult: logisticEval },
    { name: 'Decision Tree Classifier', type: 'DECISION_TREE' as const, evalResult: treeEval },
  ];

  const metrics: MLModelBenchmarkMetrics[] = [];
  let anyModelPassedGate = false;

  for (const m of models) {
    const ev = m.evalResult;
    const reasons: string[] = [];

    // Gate checks
    if (ev.activeHitRateCi95LowerPct < gateCriteria.minDirectionalAccuracyWilsonLowerPct) {
      reasons.push(
        `Directional accuracy Wilson 95% lower bound (${ev.activeHitRateCi95LowerPct.toFixed(2)}%) does not exceed 50.0% random-guess threshold.`
      );
    }
    if (gateCriteria.requirePositiveNetReturnAfterCosts && ev.cumulativeReturnNetPct <= 0) {
      reasons.push(
        `Net cumulative return after statutory Indian costs (${ev.cumulativeReturnNetPct.toFixed(2)}%) is not positive.`
      );
    }
    if (ev.sharpeRatioZeroRf <= gateCriteria.minSharpeRatio) {
      reasons.push(
        `Annualized Sharpe ratio (${ev.sharpeRatioZeroRf.toFixed(2)}) does not exceed ${gateCriteria.minSharpeRatio}.`
      );
    }

    const passed = reasons.length === 0;
    if (passed) anyModelPassedGate = true;

    metrics.push({
      modelName: m.name,
      modelType: m.type,
      sampleCount: ev.sampleCount,
      maePct: ev.maeReturnPct,
      rmsePct: ev.rmseReturnPct,
      directionalAccuracyPct: ev.activeDirectionalAccuracyPct,
      wilson95CILowerPct: ev.activeHitRateCi95LowerPct,
      wilson95CIUpperPct: ev.activeHitRateCi95UpperPct,
      grossCumulativeReturnPct: ev.cumulativeReturnGrossPct,
      netCumulativeReturnPct: ev.cumulativeReturnNetPct,
      annualizedSharpeRatio: ev.sharpeRatioZeroRf,
      sharpeHAC95CILower: ev.sharpeRatioHacCi95Lower,
      sharpeHAC95CIUpper: ev.sharpeRatioHacCi95Upper,
      maxDrawdownPct: ev.maxDrawdownPct,
      totalTurnoverUnits: ev.totalTurnoverUnits,
      totalFeesPaidPct: ev.totalTransactionCostPct,
      passedDeploymentGate: passed,
      gateRejectionReasons: reasons,
    });
  }

  const deploymentSummary = anyModelPassedGate
    ? 'DEPLOYMENT GATE APPROVED: At least one ML model demonstrated statistically significant alpha after transaction costs.'
    : 'DEPLOYMENT GATE REJECTED (0/3 models passed): All models failed to overcome statutory Indian transaction costs or establish a statistically significant directional edge (Wilson 95% CI > 50%). All models are strictly kept in research mode.';

  return {
    metrics,
    anyModelPassedGate,
    deploymentSummary,
  };
}
