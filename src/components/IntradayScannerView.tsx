/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import {
  Radar,
  Shield,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  CheckCircle,
  XCircle,
  ArrowRight,
  Info,
  DollarSign,
  Sliders,
  Send,
  Clock,
  Sparkles,
} from 'lucide-react';
import {
  SUPPORTED_INSTRUMENTS,
  formatINR,
} from '../services/marketDataProvider.ts';
import {
  IntradayInterval,
  createDeterministicIntradayFixture,
} from '../services/intradayData.ts';
import {
  scanIntradaySetups,
  SetupCandidate,
} from '../utils/intradayScanner.ts';
import {
  calculateCompliantPositionSize,
  DEFAULT_RISK_CONFIG,
  RiskManagementConfig,
  PositionSizingResult,
} from '../utils/riskManagement.ts';

interface IntradayScannerViewProps {
  onExecutePaperTrade?: (candidate: SetupCandidate, sizing: PositionSizingResult) => void;
  availableCashINR?: number;
  openPositionsCount?: number;
}

export function IntradayScannerView({
  onExecutePaperTrade,
  availableCashINR = 100000,
  openPositionsCount = 0,
}: IntradayScannerViewProps) {
  const [selectedSymbol, setSelectedSymbol] = useState<string>('RELIANCE.NS');
  const [selectedInterval, setSelectedInterval] = useState<IntradayInterval>('5m');
  const [riskConfig, setRiskConfig] = useState<RiskManagementConfig>(DEFAULT_RISK_CONFIG);
  const [selectedCandidate, setSelectedCandidate] = useState<SetupCandidate | null>(null);

  // Generate deterministic intraday series for the selected symbol and interval
  const intradaySeries = useMemo(() => {
    return createDeterministicIntradayFixture(
      selectedSymbol,
      '2026-10-21',
      selectedInterval,
      selectedSymbol === '^NSEI'
        ? 24800
        : selectedSymbol === '^NSEBANK'
        ? 51200
        : selectedSymbol === '^BSESN'
        ? 81500
        : selectedSymbol === 'RELIANCE.NS'
        ? 2520
        : selectedSymbol === 'TCS.NS'
        ? 3540
        : selectedSymbol === 'INFY.NS'
        ? 1580
        : 1680
    );
  }, [selectedSymbol, selectedInterval]);

  // Scan setups
  const candidates = useMemo(() => {
    return scanIntradaySetups(intradaySeries);
  }, [intradaySeries]);

  // Calculate position sizing for the selected or first candidate
  const activeCandidate = selectedCandidate || candidates[0] || null;

  const sizingResult = useMemo(() => {
    if (!activeCandidate) return null;
    return calculateCompliantPositionSize(
      activeCandidate.entryTriggerPrice,
      activeCandidate.stopLossPrice,
      activeCandidate.targetPrice,
      activeCandidate.direction,
      riskConfig.accountCapitalINR,
      availableCashINR,
      openPositionsCount,
      0,
      riskConfig
    );
  }, [activeCandidate, riskConfig, availableCashINR, openPositionsCount]);

  return (
    <div className="space-y-6">
      {/* Top Banner & Disclosures */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Radar className="w-6 h-6 text-indigo-400" />
              <h2 className="text-xl font-bold text-white">Intraday Setup Scanner & Risk Engine</h2>
              <span className="bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-xs px-2.5 py-0.5 rounded-full font-medium">
                Stage 4E Verified
              </span>
            </div>
            <p className="text-slate-400 text-sm mt-1">
              Deterministic, leakage-free setup detector across VWAP pullbacks, Opening Range Breakouts,
              and momentum crossovers with statutory Indian cost deduction (MIS rates).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div>
              <label className="text-xs text-slate-400 block mb-1">Instrument</label>
              <select
                value={selectedSymbol}
                onChange={(e) => {
                  setSelectedSymbol(e.target.value);
                  setSelectedCandidate(null);
                }}
                className="bg-slate-800 text-white border border-slate-700 text-sm rounded-lg px-3 py-1.5 focus:ring-1 focus:ring-indigo-500"
              >
                {SUPPORTED_INSTRUMENTS.map((inst) => (
                  <option key={inst.symbol} value={inst.symbol}>
                    {inst.name} ({inst.symbol}) [{inst.type}]
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs text-slate-400 block mb-1">Timeframe</label>
              <select
                value={selectedInterval}
                onChange={(e) => setSelectedInterval(e.target.value as IntradayInterval)}
                className="bg-slate-800 text-white border border-slate-700 text-sm rounded-lg px-3 py-1.5 focus:ring-1 focus:ring-indigo-500"
              >
                <option value="5m">5 Minutes (Standard)</option>
                <option value="15m">15 Minutes</option>
                <option value="30m">30 Minutes</option>
                <option value="60m">60 Minutes</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Grid: Setup Candidates (Left) & Risk Calculator (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Candidate Setups List (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400" />
              Detected Setups ({candidates.length})
            </h3>
            <span className="text-xs text-slate-400">
              {intradaySeries.metadata.validBars} completed {selectedInterval} bars inspected
            </span>
          </div>

          {candidates.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
              <Info className="w-8 h-8 text-slate-500 mx-auto mb-2" />
              <p className="text-slate-300 font-medium">No setups qualified at current bar</p>
              <p className="text-slate-500 text-xs mt-1">
                Setups require strict technical alignment (e.g. within 0.25% of VWAP with RSI confirmation,
                or clear 15m ORB breakout).
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {candidates.map((cand) => {
                const isSelected = activeCandidate?.id === cand.id;
                const isLong = cand.direction === 'LONG';
                return (
                  <div
                    key={cand.id}
                    onClick={() => setSelectedCandidate(cand)}
                    className={`cursor-pointer border rounded-xl p-4 transition-all ${
                      isSelected
                        ? 'bg-indigo-950/20 border-indigo-500 shadow-md'
                        : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`p-1.5 rounded-lg ${
                            isLong ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                          }`}
                        >
                          {isLong ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                        </span>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-white text-sm">{cand.setupType.replace(/_/g, ' ')}</span>
                            <span
                              className={`text-xs px-2 py-0.5 rounded font-semibold ${
                                isLong ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
                              }`}
                            >
                              {cand.direction}
                            </span>
                          </div>
                          <span className="text-xs text-slate-400">{cand.signalTimestampIST}</span>
                        </div>
                      </div>

                      <div className="text-right">
                        <span className="text-xs text-slate-400 block">Entry Trigger</span>
                        <span className="text-base font-bold text-white">₹{cand.entryTriggerPrice.toFixed(2)}</span>
                      </div>
                    </div>

                    <p className="text-xs text-slate-300 mt-2.5 bg-slate-800/50 p-2 rounded border border-slate-800">
                      {cand.reasonQualified}
                    </p>

                    <div className="grid grid-cols-4 gap-2 mt-3 text-center border-t border-slate-800/80 pt-2.5">
                      <div>
                        <span className="text-[11px] text-slate-500 block">Stop Loss</span>
                        <span className="text-xs font-semibold text-rose-400">₹{cand.stopLossPrice.toFixed(2)}</span>
                      </div>
                      <div>
                        <span className="text-[11px] text-slate-500 block">Target</span>
                        <span className="text-xs font-semibold text-emerald-400">₹{cand.targetPrice.toFixed(2)}</span>
                      </div>
                      <div>
                        <span className="text-[11px] text-slate-500 block">Net R:R</span>
                        <span className="text-xs font-semibold text-amber-300">{cand.netRewardRiskRatio.toFixed(2)}:1</span>
                      </div>
                      <div>
                        <span className="text-[11px] text-slate-500 block">Status</span>
                        <span
                          className={`text-[11px] font-bold ${
                            cand.status === 'QUALIFIED' ? 'text-emerald-400' : 'text-amber-500'
                          }`}
                        >
                          {cand.status}
                        </span>
                      </div>
                    </div>

                    {cand.rejectionReason && (
                      <div className="mt-2 text-[11px] text-amber-400/90 flex items-center gap-1 bg-amber-500/10 px-2 py-1 rounded border border-amber-500/20">
                        <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                        <span>{cand.rejectionReason}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Risk Sizing & Execution Panel (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-semibold text-white flex items-center gap-2">
                <Shield className="w-4 h-4 text-emerald-400" />
                Indian Risk Sizer
              </h3>
              <span className="text-xs text-slate-400 font-mono">SEBI 5x MIS Margin</span>
            </div>

            {/* Config Sliders */}
            <div className="space-y-3 text-xs">
              <div>
                <div className="flex justify-between text-slate-400 mb-1">
                  <span>Account Capital</span>
                  <span className="text-white font-mono">₹{riskConfig.accountCapitalINR.toLocaleString('en-IN')}</span>
                </div>
                <input
                  type="range"
                  min="25000"
                  max="500000"
                  step="25000"
                  value={riskConfig.accountCapitalINR}
                  onChange={(e) =>
                    setRiskConfig({ ...riskConfig, accountCapitalINR: Number(e.target.value) })
                  }
                  className="w-full accent-indigo-500 bg-slate-800 rounded"
                />
              </div>

              <div>
                <div className="flex justify-between text-slate-400 mb-1">
                  <span>Risk Per Trade (%)</span>
                  <span className="text-white font-mono">{riskConfig.maxRiskPerTradePct}% (₹{((riskConfig.accountCapitalINR * riskConfig.maxRiskPerTradePct) / 100).toFixed(0)})</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="3.0"
                  step="0.5"
                  value={riskConfig.maxRiskPerTradePct}
                  onChange={(e) =>
                    setRiskConfig({ ...riskConfig, maxRiskPerTradePct: Number(e.target.value) })
                  }
                  className="w-full accent-indigo-500 bg-slate-800 rounded"
                />
              </div>
            </div>

            {/* Sizing Breakdown Card */}
            {sizingResult ? (
              <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">Approved Position Size:</span>
                  <span className="text-lg font-bold text-white font-mono">
                    {sizingResult.calculatedQuantity} Shares
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs border-t border-slate-800 pt-2.5">
                  <div>
                    <span className="text-slate-500 block">Position Value:</span>
                    <span className="text-white font-medium">₹{sizingResult.positionNotionalINR.toLocaleString('en-IN')}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Margin Blocked (20%):</span>
                    <span className="text-indigo-300 font-medium">₹{sizingResult.marginRequiredINR.toLocaleString('en-IN')}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Net Risk at Stop:</span>
                    <span className="text-rose-400 font-medium">₹{sizingResult.estimatedNetLossAtStopINR.toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Net Reward at Target:</span>
                    <span className="text-emerald-400 font-medium">₹{sizingResult.estimatedNetProfitAtTargetINR.toFixed(2)}</span>
                  </div>
                </div>

                <div className="text-[11px] text-slate-400 border-t border-slate-800 pt-2 flex items-center justify-between">
                  <span>Statutory Indian Costs:</span>
                  <span className="text-amber-300 font-mono">₹{sizingResult.estimatedRoundTripCostINR.toFixed(2)} (MIS Schedule)</span>
                </div>

                {sizingResult.isApproved ? (
                  <button
                    disabled={!activeCandidate?.isTradableCashEquity}
                    onClick={() => {
                      if (onExecutePaperTrade && activeCandidate && sizingResult) {
                        onExecutePaperTrade(activeCandidate, sizingResult);
                      }
                    }}
                    className={`w-full py-2.5 px-4 rounded-lg font-bold text-xs flex items-center justify-center gap-2 transition-all ${
                      activeCandidate?.isTradableCashEquity
                        ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-950/40'
                        : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                    }`}
                  >
                    <Send className="w-4 h-4" />
                    {activeCandidate?.isTradableCashEquity
                      ? `Execute Paper ${activeCandidate.direction} (${sizingResult.calculatedQuantity} shares)`
                      : 'Non-Tradable Spot Index Proxy'}
                  </button>
                ) : (
                  <div className="bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs p-2.5 rounded-lg flex items-start gap-2">
                    <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>{sizingResult.rejectionReason}</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-4 text-center text-xs text-slate-500">
                Select a setup to evaluate risk sizing
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
