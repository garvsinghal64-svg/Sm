/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import {
  Brain,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  TrendingDown,
  TrendingUp,
  BarChart3,
  Layers,
  Info,
  Scale,
} from 'lucide-react';
import {
  SUPPORTED_INSTRUMENTS,
  formatINR,
} from '../services/marketDataProvider.ts';
import {
  createDeterministicOfflineResearchFixture,
  buildHistoricalPredictionDataset,
  PredictionResearchObservation,
} from '../utils/predictionResearch.ts';
import {
  benchmarkMachineLearningModels,
  MLModelBenchmarkMetrics,
  DEFAULT_DEPLOYMENT_GATE,
} from '../utils/mlBenchmarking.ts';

export function MLBenchmarkView() {
  const [selectedSymbol, setSelectedSymbol] = useState<string>('RELIANCE.NS');
  const [executionMode, setExecutionMode] = useState<'INTRADAY_NEXT_OPEN_TO_CLOSE' | 'MULTI_DAY_POSITION'>(
    'INTRADAY_NEXT_OPEN_TO_CLOSE'
  );

  // Generate deterministic observations for selected instrument
  const dataset = useMemo(() => {
    const fixture = createDeterministicOfflineResearchFixture({ symbol: selectedSymbol, candleCount: 180, startYear: 2024 });
    return buildHistoricalPredictionDataset(fixture);
  }, [selectedSymbol]);

  // Run ML benchmarking comparing Ridge, Logistic, and Decision Tree
  const benchmarkResult = useMemo(() => {
    const obs = dataset.usableObservations;
    if (obs.length < 30) return null;

    // Split 80% train / 20% test
    const splitIdx = Math.floor(obs.length * 0.8);
    const trainObs = obs.slice(0, splitIdx);
    const testObs = obs.slice(splitIdx);

    return benchmarkMachineLearningModels(trainObs, testObs, executionMode, DEFAULT_DEPLOYMENT_GATE);
  }, [dataset, executionMode]);

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Brain className="w-6 h-6 text-purple-400" />
              <h2 className="text-xl font-bold text-white">Stage 4G: Machine Learning Benchmarking</h2>
              <span className="bg-purple-500/10 text-purple-400 border border-purple-500/20 text-xs px-2.5 py-0.5 rounded-full font-medium">
                Research Mode Only
              </span>
            </div>
            <p className="text-slate-400 text-sm mt-1">
              Leakage-free, walk-forward benchmarking comparing Ridge Regression, Logistic Classifier,
              and Decision Trees against verified baselines under realistic Indian market transaction costs.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div>
              <label className="text-xs text-slate-400 block mb-1">Instrument</label>
              <select
                value={selectedSymbol}
                onChange={(e) => setSelectedSymbol(e.target.value)}
                className="bg-slate-800 text-white border border-slate-700 text-sm rounded-lg px-3 py-1.5 focus:ring-1 focus:ring-purple-500"
              >
                {SUPPORTED_INSTRUMENTS.map((inst) => (
                  <option key={inst.symbol} value={inst.symbol}>
                    {inst.name} ({inst.symbol}) [{inst.type}]
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs text-slate-400 block mb-1">Execution Mode</label>
              <select
                value={executionMode}
                onChange={(e) =>
                  setExecutionMode(
                    e.target.value as 'INTRADAY_NEXT_OPEN_TO_CLOSE' | 'MULTI_DAY_POSITION'
                  )
                }
                className="bg-slate-800 text-white border border-slate-700 text-sm rounded-lg px-3 py-1.5 focus:ring-1 focus:ring-purple-500"
              >
                <option value="INTRADAY_NEXT_OPEN_TO_CLOSE">Intraday Next-Open to Close</option>
                <option value="MULTI_DAY_POSITION">Multi-Day Holding with Gaps</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Predeclared Deployment Gate Status Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm space-y-3">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Scale className="w-5 h-5 text-amber-400" />
            <h3 className="text-base font-bold text-white">Predeclared Model Deployment Gate</h3>
          </div>
          <span
            className={`text-xs px-2.5 py-1 rounded-full font-bold border ${
              benchmarkResult?.anyModelPassedGate
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
            }`}
          >
            {benchmarkResult?.anyModelPassedGate
              ? 'GATE PASSED'
              : 'GATE REJECTED: RESEARCH MODE ONLY'}
          </span>
        </div>

        <p className="text-xs text-slate-300">
          <strong>Non-Negotiable Rule:</strong> A model is prohibited from driving live or automated trading
          signals unless its 95% Wilson confidence interval lower bound for Directional Accuracy strictly exceeds
          50.0% (genuine statistical edge) and its Net Return after statutory Indian transaction costs is positive.
        </p>

        <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-xs text-slate-400 space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-200">System Verdict:</span>
            <span>{benchmarkResult?.deploymentSummary}</span>
          </div>
        </div>
      </div>

      {/* Models Comparison Table */}
      {benchmarkResult && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Layers className="w-4 h-4 text-purple-400" />
              Out-of-Sample Performance Benchmarks ({benchmarkResult.metrics[0]?.sampleCount} Test Bars)
            </h3>
            <span className="text-xs text-slate-400 font-mono">Side-Specific Indian Costs Deducted</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="py-2.5 px-3">Model</th>
                  <th className="py-2.5 px-3">MAE (%)</th>
                  <th className="py-2.5 px-3">RMSE (%)</th>
                  <th className="py-2.5 px-3">Active Dir. Acc.</th>
                  <th className="py-2.5 px-3">95% Wilson CI</th>
                  <th className="py-2.5 px-3">Gross Return</th>
                  <th className="py-2.5 px-3">Net Return</th>
                  <th className="py-2.5 px-3">Sharpe (Lo HAC)</th>
                  <th className="py-2.5 px-3">Turnover</th>
                  <th className="py-2.5 px-3 text-right">Gate Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {benchmarkResult.metrics.map((m) => (
                  <tr key={m.modelName} className="hover:bg-slate-800/40">
                    <td className="py-2.5 px-3 font-bold text-white">{m.modelName}</td>
                    <td className="py-2.5 px-3 font-mono">{m.maePct.toFixed(4)}%</td>
                    <td className="py-2.5 px-3 font-mono">{m.rmsePct.toFixed(4)}%</td>
                    <td className="py-2.5 px-3 font-mono font-semibold text-slate-200">
                      {m.directionalAccuracyPct.toFixed(2)}%
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-400">
                      [{m.wilson95CILowerPct.toFixed(1)}%, {m.wilson95CIUpperPct.toFixed(1)}%]
                    </td>
                    <td className="py-2.5 px-3 font-mono">
                      <span className={m.grossCumulativeReturnPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                        {m.grossCumulativeReturnPct >= 0 ? '+' : ''}
                        {m.grossCumulativeReturnPct.toFixed(2)}%
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-mono font-bold">
                      <span className={m.netCumulativeReturnPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                        {m.netCumulativeReturnPct >= 0 ? '+' : ''}
                        {m.netCumulativeReturnPct.toFixed(2)}%
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-mono">
                      <span className={m.annualizedSharpeRatio >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                        {m.annualizedSharpeRatio.toFixed(2)}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-300">{m.totalTurnoverUnits.toFixed(1)}x</td>
                    <td className="py-2.5 px-3 text-right">
                      {m.passedDeploymentGate ? (
                        <span className="text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                          QUALIFIED
                        </span>
                      ) : (
                        <span
                          className="text-rose-400 font-bold bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20"
                          title={m.gateRejectionReasons.join('; ')}
                        >
                          REJECTED
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Rejection Explanations */}
          <div className="space-y-2 pt-2 border-t border-slate-800 text-xs">
            {benchmarkResult.metrics.map(
              (m) =>
                m.gateRejectionReasons.length > 0 && (
                  <div
                    key={m.modelName}
                    className="bg-slate-950 p-2.5 rounded border border-slate-800 text-slate-400 flex items-start gap-2"
                  >
                    <Info className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <span className="font-semibold text-slate-200">{m.modelName}:</span>{' '}
                      {m.gateRejectionReasons.join(' ')}
                    </div>
                  </div>
                )
            )}
          </div>
        </div>
      )}
    </div>
  );
}
