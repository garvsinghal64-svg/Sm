/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect, useRef } from 'react';
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
  Play,
  RotateCcw,
  Plus,
  Trash2,
  Filter,
  Layers,
  ChevronDown,
  RefreshCw,
} from 'lucide-react';
import {
  formatINR,
} from '../services/marketDataProvider.ts';
import {
  IntradayInterval,
  createDeterministicIntradayFixture,
  fetchLiveIntradaySeries,
  IntradaySeries,
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
import {
  MarketUniverseManager,
  UniverseInstrument,
  executeBatchScan,
  UniverseScanProgress,
} from '../services/marketUniverse.ts';
import {
  rankIntradayOpportunities,
  DecisionEngineResult,
  RankedOpportunity,
} from '../utils/opportunityRanker.ts';
import { TradePlanCard } from './TradePlanCard.tsx';
import { createDeterministicMacroFixture, assessMacroRegime } from '../services/globalMarketData.ts';
import { createDeterministicNewsFixture } from '../services/newsService.ts';

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
  // Mode: Universe Scanner vs Manual Single Instrument
  const [scannerMode, setScannerMode] = useState<'UNIVERSE' | 'SINGLE'>('UNIVERSE');
  const [isLiveDataSource, setIsLiveDataSource] = useState<boolean>(false);
  const [selectedInterval, setSelectedInterval] = useState<IntradayInterval>('5m');
  const [riskConfig, setRiskConfig] = useState<RiskManagementConfig>(DEFAULT_RISK_CONFIG);

  // Universe Manager
  const universeMgr = useMemo(() => new MarketUniverseManager(), []);
  const [universeList, setUniverseList] = useState<UniverseInstrument[]>(universeMgr.getAllInstruments());
  const [showUniverseSettings, setShowUniverseSettings] = useState<boolean>(false);
  const [newSymbolInput, setNewSymbolInput] = useState<string>('');
  const [addSymbolFeedback, setAddSymbolFeedback] = useState<{ success?: boolean; message?: string }>({});

  // Single-Instrument state
  const [selectedSymbol, setSelectedSymbol] = useState<string>('RELIANCE.NS');
  const [singleCandidateSelected, setSingleCandidateSelected] = useState<SetupCandidate | null>(null);

  // Universe Scan execution state
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanProgress, setScanProgress] = useState<UniverseScanProgress | null>(null);
  const [allScannedCandidates, setAllScannedCandidates] = useState<SetupCandidate[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Filter settings
  const [excludeIndicesFromScan, setExcludeIndicesFromScan] = useState<boolean>(false);

  // Macro & News Context
  const macroRegime = useMemo(() => assessMacroRegime(createDeterministicMacroFixture()), []);
  const newsItems = useMemo(() => createDeterministicNewsFixture(), []);

  // Run Universe Scan
  const runUniverseScan = async () => {
    setIsScanning(true);
    abortControllerRef.current = new AbortController();

    const targetInstruments = universeMgr.getEligibleUniverse({
      includeIndices: !excludeIndicesFromScan,
    });

    const collectedCandidates: SetupCandidate[] = [];

    await executeBatchScan(
      targetInstruments,
      async (inst) => {
        let series: IntradaySeries;
        if (isLiveDataSource) {
          try {
            series = await fetchLiveIntradaySeries(inst.symbol, selectedInterval, '1d');
          } catch {
            // Fallback to offline fixture if live network fails
            series = createDeterministicIntradayFixture(inst.symbol, '2026-10-29', selectedInterval, 1000);
          }
        } else {
          series = createDeterministicIntradayFixture(inst.symbol, '2026-10-29', selectedInterval, 1000);
        }

        const setups = scanIntradaySetups(series);
        collectedCandidates.push(...setups);
        return setups;
      },
      (p) => setScanProgress(p),
      { batchSize: 4, delayMs: 150, signal: abortControllerRef.current.signal }
    );

    setAllScannedCandidates(collectedCandidates);
    setIsScanning(false);
  };

  // Run initial scan on mount
  useEffect(() => {
    runUniverseScan();
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [isLiveDataSource, selectedInterval]);

  // Evaluate Decision Engine & Cross-Sectional Ranking
  const decisionResult: DecisionEngineResult = useMemo(() => {
    return rankIntradayOpportunities(allScannedCandidates, {
      accountEquityINR: riskConfig.accountCapitalINR,
      availableCashINR,
      currentOpenPositions: openPositionsCount,
      riskConfig,
      regime: macroRegime,
      newsItems,
      isMarketOpen: true,
    });
  }, [allScannedCandidates, riskConfig, availableCashINR, openPositionsCount, macroRegime, newsItems]);

  // Single-Instrument manual series
  const manualSeries = useMemo(() => {
    return createDeterministicIntradayFixture(
      selectedSymbol,
      '2026-10-29',
      selectedInterval,
      selectedSymbol === '^NSEI' ? 24800 : selectedSymbol === '^NSEBANK' ? 51200 : selectedSymbol === '^BSESN' ? 81500 : 2500
    );
  }, [selectedSymbol, selectedInterval]);

  const manualCandidates = useMemo(() => {
    return scanIntradaySetups(manualSeries);
  }, [manualSeries]);

  const handleAddSymbol = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSymbolInput.trim()) return;

    const res = universeMgr.addSymbol(newSymbolInput.trim());
    setAddSymbolFeedback({ success: res.success, message: res.message });
    if (res.success) {
      setUniverseList(universeMgr.getAllInstruments());
      setNewSymbolInput('');
    }
  };

  const handleRemoveSymbol = (symbol: string) => {
    universeMgr.removeSymbol(symbol);
    setUniverseList(universeMgr.getAllInstruments());
  };

  const handleDeployToPaper = (opp: RankedOpportunity) => {
    if (onExecutePaperTrade && opp.riskEvaluation) {
      onExecutePaperTrade(opp.candidate, opp.riskEvaluation);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Mode Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-slate-900 border border-slate-800 rounded-2xl">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-cyan-500/10 border border-cyan-500/20 rounded-xl text-cyan-400">
            <Radar className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
              <span>Automatic Universe Scanner & Decision Engine</span>
              <span className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                isLiveDataSource
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                  : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
              }`}>
                {isLiveDataSource ? 'LIVE YAHOO 15M DELAY' : 'DETERMINISTIC FIXTURE'}
              </span>
            </h2>
            <p className="text-xs text-slate-400">
              Cross-sectional ranking of eligible NSE equities with statutory Indian MIS risk management
            </p>
          </div>
        </div>

        {/* Mode & Live Switch */}
        <div className="flex items-center gap-2">
          <div className="bg-slate-950 p-1 rounded-xl border border-slate-800 flex items-center gap-1">
            <button
              onClick={() => setScannerMode('UNIVERSE')}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition ${
                scannerMode === 'UNIVERSE'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Universe Mode ({universeList.length})
            </button>
            <button
              onClick={() => setScannerMode('SINGLE')}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition ${
                scannerMode === 'SINGLE'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Single Asset
            </button>
          </div>

          <button
            onClick={() => setIsLiveDataSource(!isLiveDataSource)}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-300 transition"
          >
            {isLiveDataSource ? 'Switch Offline' : 'Switch Live'}
          </button>
        </div>
      </div>

      {/* TOP DECISION PLAN CARD (Primary Support Output) */}
      <TradePlanCard
        decision={decisionResult}
        onDeployToPaperTrading={handleDeployToPaper}
      />

      {/* Universe Controls / Universe Manager Panel */}
      {scannerMode === 'UNIVERSE' && (
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                onClick={runUniverseScan}
                disabled={isScanning}
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-bold rounded-xl flex items-center gap-2 transition shadow-lg shadow-cyan-950/40"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
                <span>{isScanning ? 'Scanning Universe...' : 'Scan Entire Universe'}</span>
              </button>

              <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer pl-2">
                <input
                  type="checkbox"
                  checked={excludeIndicesFromScan}
                  onChange={(e) => setExcludeIndicesFromScan(e.target.checked)}
                  className="rounded bg-slate-800 border-slate-700 text-cyan-500 focus:ring-0"
                />
                <span>Exclude Spot Indices from Stock Scan</span>
              </label>
            </div>

            <button
              onClick={() => setShowUniverseSettings(!showUniverseSettings)}
              className="px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-white bg-slate-950 border border-slate-800 rounded-lg flex items-center gap-1.5 transition self-start sm:self-auto"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Manage Universe ({universeList.length} Symbols)</span>
              <ChevronDown className={`w-3 h-3 transition-transform ${showUniverseSettings ? 'rotate-180' : ''}`} />
            </button>
          </div>

          {/* Progress Bar when scanning */}
          {isScanning && scanProgress && (
            <div className="space-y-1.5 p-3 bg-slate-950 rounded-xl border border-slate-800">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-cyan-400">
                  Scanning: {scanProgress.currentSymbol} ({scanProgress.scannedCount} of {scanProgress.totalEligible})
                </span>
                <span className="text-slate-400">{scanProgress.percentComplete}%</span>
              </div>
              <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-cyan-500 h-full transition-all duration-150"
                  style={{ width: `${scanProgress.percentComplete}%` }}
                />
              </div>
            </div>
          )}

          {/* Universe Management Expandable Drawer */}
          {showUniverseSettings && (
            <div className="p-4 bg-slate-950 rounded-xl border border-slate-800/80 space-y-3 text-xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-800">
                <span className="font-bold text-slate-200">Custom Universe Manager</span>
                <button
                  onClick={() => {
                    universeMgr.resetToDefault();
                    setUniverseList(universeMgr.getAllInstruments());
                  }}
                  className="text-slate-400 hover:text-rose-400 text-[11px] underline"
                >
                  Reset to NIFTY 50 Defaults
                </button>
              </div>

              {/* Add Symbol Input */}
              <form onSubmit={handleAddSymbol} className="flex gap-2">
                <input
                  type="text"
                  value={newSymbolInput}
                  onChange={(e) => setNewSymbolInput(e.target.value)}
                  placeholder="Enter NSE Symbol (e.g. ASIANPAINT or COALINDIA.NS)..."
                  className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                />
                <button
                  type="submit"
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-lg flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" /> Add
                </button>
              </form>

              {addSymbolFeedback.message && (
                <div className={`text-[11px] font-medium ${addSymbolFeedback.success ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {addSymbolFeedback.message}
                </div>
              )}

              {/* Chip list of symbols */}
              <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto p-1">
                {universeList.map((inst) => (
                  <div
                    key={inst.symbol}
                    className="flex items-center gap-1.5 px-2 py-1 bg-slate-900 border border-slate-800 rounded-md font-mono text-[11px] text-slate-300"
                  >
                    <span>{inst.symbol}</span>
                    {inst.type === 'INDEX' && (
                      <span className="text-[9px] bg-slate-800 text-slate-400 px-1 rounded">Index</span>
                    )}
                    {inst.isCustom && (
                      <button
                        onClick={() => handleRemoveSymbol(inst.symbol)}
                        className="text-slate-500 hover:text-rose-400 ml-1"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* SINGLE ASSET MANUAL SELECTOR (Optional fallback workflow preserved) */}
      {scannerMode === 'SINGLE' && (
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-slate-400">Select Instrument:</span>
            <select
              value={selectedSymbol}
              onChange={(e) => setSelectedSymbol(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-cyan-500"
            >
              {universeList.map((inst) => (
                <option key={inst.symbol} value={inst.symbol}>
                  {inst.symbol} - {inst.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-slate-400">Interval:</span>
            <select
              value={selectedInterval}
              onChange={(e) => setSelectedInterval(e.target.value as IntradayInterval)}
              className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-cyan-500"
            >
              <option value="1m">1m (Intraday)</option>
              <option value="5m">5m (Optimal)</option>
              <option value="15m">15m (Conservative)</option>
              <option value="30m">30m (Swing)</option>
              <option value="60m">60m (Hourly)</option>
            </select>
          </div>
        </div>
      )}

      {/* CROSS-SECTIONAL RANKED OPPORTUNITIES TABLE */}
      {scannerMode === 'UNIVERSE' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          <div className="p-4 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-white">Ranked Candidate Setups</span>
              <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">
                {decisionResult.rankedOpportunities.length} Qualified Candidates
              </span>
            </div>
            <span className="text-[11px] font-mono text-slate-400">
              Sorted by Composite Score (0–100)
            </span>
          </div>

          {decisionResult.rankedOpportunities.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs">
              No qualified technical setups detected. The engine requires strict net R:R ≥ 1.5, volume confirmation, and SEBI compliance.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-950/60 border-b border-slate-800 text-[11px] font-mono text-slate-400">
                    <th className="py-2.5 px-3">Rank</th>
                    <th className="py-2.5 px-3">Instrument</th>
                    <th className="py-2.5 px-3">Setup Type</th>
                    <th className="py-2.5 px-3">Direction</th>
                    <th className="py-2.5 px-3">Entry / Stop / Target</th>
                    <th className="py-2.5 px-3">Net R:R</th>
                    <th className="py-2.5 px-3">Score</th>
                    <th className="py-2.5 px-3">Sized Qty</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {decisionResult.rankedOpportunities.map((opp) => {
                    const isLong = opp.candidate.direction === 'LONG';
                    const isTop = opp.rank === 1;

                    return (
                      <tr
                        key={opp.candidate.id}
                        className={`hover:bg-slate-850/50 transition ${
                          isTop ? 'bg-emerald-500/5' : ''
                        }`}
                      >
                        <td className="py-3 px-3">
                          <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                            isTop ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-300'
                          }`}>
                            #{opp.rank}
                          </span>
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-bold text-white text-xs">{opp.candidate.symbol}</div>
                          <div className="text-[10px] text-slate-400 truncate max-w-[120px] font-sans">
                            {opp.candidate.name}
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <span className="text-slate-300 text-[11px]">
                            {opp.candidate.setupType.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="py-3 px-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            isLong ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                          }`}>
                            {opp.candidate.direction}
                          </span>
                        </td>
                        <td className="py-3 px-3">
                          <div className="text-slate-200">
                            ₹{opp.candidate.entryTriggerPrice.toFixed(2)}
                          </div>
                          <div className="text-[10px] text-slate-400">
                            SL: ₹{opp.candidate.stopLossPrice.toFixed(2)} | TGT: ₹{opp.candidate.targetPrice.toFixed(2)}
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <span className={`font-bold ${
                            opp.candidate.netRewardRiskRatio >= 1.5 ? 'text-emerald-400' : 'text-amber-400'
                          }`}>
                            {opp.candidate.netRewardRiskRatio.toFixed(2)}:1
                          </span>
                        </td>
                        <td className="py-3 px-3">
                          <span className="font-bold text-white text-sm">{opp.totalScore}</span>
                          <span className="text-[10px] text-slate-500">/100</span>
                        </td>
                        <td className="py-3 px-3">
                          <span className="text-slate-200 font-bold">
                            {opp.riskEvaluation.calculatedQuantity > 0 ? `${opp.riskEvaluation.calculatedQuantity} sh` : '0 (Cap)'}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right">
                          {onExecutePaperTrade && (
                            <button
                              onClick={() => handleDeployToPaper(opp)}
                              className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-sans text-[11px] font-bold rounded-lg transition"
                            >
                              Paper Trade
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
