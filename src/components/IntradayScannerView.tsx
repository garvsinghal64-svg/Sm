/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
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
  AlertTriangle,
  Radio,
  Pause,
  Eye,
  Bell,
  Check,
} from 'lucide-react';
import {
  formatINR,
} from '../services/marketDataProvider.ts';
import {
  IntradayInterval,
  createDeterministicIntradayFixture,
  fetchLiveIntradaySeries,
  validateLiveIntradayFreshness,
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
  UNIVERSE_COVERAGE_METADATA,
} from '../services/marketUniverse.ts';
import {
  rankIntradayOpportunities,
  DecisionEngineResult,
  RankedOpportunity,
} from '../utils/opportunityRanker.ts';
import { TradePlanCard } from './TradePlanCard.tsx';
import {
  createDeterministicMacroFixture,
  assessMacroRegime,
  fetchCachedLiveMacroData,
  MacroIndicatorItem,
  MacroRegimeAssessment,
} from '../services/globalMarketData.ts';
import {
  createDeterministicNewsFixture,
  fetchCachedLiveNews,
  VerifiedNewsItem,
} from '../services/newsService.ts';
import {
  getMarketStatus,
  MarketStatus,
} from '../utils/dateEngine.ts';

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

  // Explicit Data Mode: LIVE_MARKET vs DEMO_FIXTURE (No silent fallbacks)
  const [dataMode, setDataMode] = useState<'LIVE_MARKET' | 'DEMO_FIXTURE'>('LIVE_MARKET');
  const [selectedInterval, setSelectedInterval] = useState<IntradayInterval>('5m');
  const [riskConfig, setRiskConfig] = useState<RiskManagementConfig>(DEFAULT_RISK_CONFIG);

  // Market session status from dateEngine
  const [marketStatus, setMarketStatus] = useState<MarketStatus>(() => getMarketStatus());

  // Automatic 60-Second Scan Timer
  const [isAutoScanEnabled, setIsAutoScanEnabled] = useState<boolean>(true);
  const [nextScanSeconds, setNextScanSeconds] = useState<number>(60);
  const [lastScanTimestampIST, setLastScanTimestampIST] = useState<string>('Not scanned yet');

  // Universe Manager
  const universeMgr = useMemo(() => new MarketUniverseManager(), []);
  const [universeList, setUniverseList] = useState<UniverseInstrument[]>(universeMgr.getAllInstruments());
  const [showUniverseSettings, setShowUniverseSettings] = useState<boolean>(false);
  const [newSymbolInput, setNewSymbolInput] = useState<string>('');
  const [addSymbolFeedback, setAddSymbolFeedback] = useState<{ success?: boolean; message?: string }>({});

  // Single-Instrument state
  const [selectedSymbol, setSelectedSymbol] = useState<string>('RELIANCE.NS');

  // Universe Scan execution state
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanProgress, setScanProgress] = useState<UniverseScanProgress | null>(null);
  const [allScannedCandidates, setAllScannedCandidates] = useState<SetupCandidate[]>([]);
  const [failedSymbols, setFailedSymbols] = useState<{ symbol: string; reason: string }[]>([]);
  const [showFailedSymbols, setShowFailedSymbols] = useState<boolean>(false);

  // Filter settings
  const [excludeIndicesFromScan, setExcludeIndicesFromScan] = useState<boolean>(false);

  // Macro & News Live Data State
  const [macroRegime, setMacroRegime] = useState<MacroRegimeAssessment | undefined>(undefined);
  const [macroFreshnessInfo, setMacroFreshnessInfo] = useState<string>('Loading macro context...');
  const [newsItems, setNewsItems] = useState<VerifiedNewsItem[]>([]);
  const [newsFreshnessInfo, setNewsFreshnessInfo] = useState<string>('Loading news context...');

  // Alert tracking for deduplication
  const [activeAlert, setActiveAlert] = useState<{ id: string; title: string; message: string } | null>(null);
  const alertedSetupsRef = useRef<Set<string>>(new Set());

  // Refs for scan lifecycle and cancellation
  const abortControllerRef = useRef<AbortController | null>(null);
  const isScanningRef = useRef<boolean>(false);

  // Update market status every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setMarketStatus(getMarketStatus());
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // Fetch / refresh macro and news context whenever dataMode changes
  const loadContextData = useCallback(async () => {
    if (dataMode === 'LIVE_MARKET') {
      try {
        const macroRes = await fetchCachedLiveMacroData();
        setMacroRegime(macroRes.regime);
        setMacroFreshnessInfo(
          macroRes.isLive
            ? `Live Macro (${macroRes.indicators.filter((i) => i.freshness !== 'UNAVAILABLE').length}/9 feeds active, ${macroRes.regime.overallRegime})`
            : 'Macro feeds partially offline (neutral fallback)'
        );
      } catch {
        setMacroRegime(undefined);
        setMacroFreshnessInfo('Macro feed offline (neutral bias)');
      }

      try {
        const newsRes = await fetchCachedLiveNews();
        if (newsRes.status === 'LIVE_VERIFIED') {
          setNewsItems(newsRes.items);
          setNewsFreshnessInfo(`Live RSS Feed (${newsRes.items.length} items verified)`);
        } else {
          setNewsItems([]);
          setNewsFreshnessInfo('News feed unreachable (zero fake headlines)');
        }
      } catch {
        setNewsItems([]);
        setNewsFreshnessInfo('News feed unavailable (zero fake headlines)');
      }
    } else {
      // DEMO FIXTURE mode: Isolated deterministic mock
      setMacroRegime(assessMacroRegime(createDeterministicMacroFixture()));
      setMacroFreshnessInfo('Demo Fixture Macro (Offline Simulation)');
      setNewsItems(createDeterministicNewsFixture());
      setNewsFreshnessInfo('Demo Fixture News (6 Verified Offline Items)');
    }
  }, [dataMode]);

  useEffect(() => {
    loadContextData();
  }, [loadContextData]);

  // Main Universe Scan Function
  const runUniverseScan = useCallback(async () => {
    if (isScanningRef.current) {
      return; // Prevent overlapping scans
    }

    isScanningRef.current = true;
    setIsScanning(true);

    // Cancel any previous in-flight requests
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    const targetInstruments = universeMgr.getEligibleUniverse({
      includeIndices: !excludeIndicesFromScan,
    });

    const collectedCandidates: SetupCandidate[] = [];
    const recordedFailures: { symbol: string; reason: string }[] = [];

    try {
      const { summary } = await executeBatchScan(
        targetInstruments,
        async (inst) => {
          let series: IntradaySeries;

          if (dataMode === 'LIVE_MARKET') {
            // Live mode: fetch real market series. NEVER fall back to fixture!
            series = await fetchLiveIntradaySeries(inst.symbol, selectedInterval, '1d', signal);

            // Validate freshness and completeness
            const freshness = validateLiveIntradayFreshness(series);
            if (!freshness.isFresh && marketStatus.isOpen) {
              throw new Error(freshness.reason || 'Data is stale or incomplete.');
            }
          } else {
            // Demo mode: deterministic fixture
            series = createDeterministicIntradayFixture(inst.symbol, '2026-10-29', selectedInterval, 1000);
          }

          const setups = scanIntradaySetups(series);
          collectedCandidates.push(...setups);
          return setups;
        },
        (progress) => {
          setScanProgress(progress);
        },
        {
          batchSize: dataMode === 'LIVE_MARKET' ? 3 : 5, // smaller batch in live mode to avoid 429
          delayMs: dataMode === 'LIVE_MARKET' ? 200 : 50,
          signal,
        }
      );

      // Extract failed instruments directly from returned batch summary
      if (summary?.failedInstruments) {
        recordedFailures.push(...summary.failedInstruments);
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        recordedFailures.push({ symbol: 'BATCH_ERROR', reason: err.message || 'Scan aborted unexpectedly' });
      }
    } finally {
      if (!signal.aborted) {
        setAllScannedCandidates(collectedCandidates);
        setFailedSymbols(recordedFailures);
        setLastScanTimestampIST(
          new Date().toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata',
            hour12: false,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          }) + ' IST'
        );
        setIsScanning(false);
        isScanningRef.current = false;
        setNextScanSeconds(60); // Reset 60s countdown
      }
    }
  }, [universeMgr, excludeIndicesFromScan, dataMode, selectedInterval, marketStatus.isOpen]);

  // Initial scan on mount and on mode change
  useEffect(() => {
    runUniverseScan();
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      isScanningRef.current = false;
    };
  }, [runUniverseScan]);

  // Automatic 60-Second Scan Countdown Loop
  useEffect(() => {
    if (!isAutoScanEnabled) return;

    const timer = setInterval(() => {
      // Only advance countdown if market is actually open or in demo mode
      if (marketStatus.isOpen || dataMode === 'DEMO_FIXTURE') {
        setNextScanSeconds((prev) => {
          if (prev <= 1) {
            // Trigger auto-scan
            runUniverseScan();
            return 60;
          }
          return prev - 1;
        });
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [isAutoScanEnabled, marketStatus.isOpen, dataMode, runUniverseScan]);

  // Evaluate Decision Engine & Cross-Sectional Ranking
  const decisionResult: DecisionEngineResult = useMemo(() => {
    return rankIntradayOpportunities(allScannedCandidates, {
      accountEquityINR: riskConfig.accountCapitalINR,
      availableCashINR,
      currentOpenPositions: openPositionsCount,
      riskConfig,
      regime: macroRegime,
      newsItems,
      isMarketOpen: dataMode === 'DEMO_FIXTURE' ? true : marketStatus.isOpen,
      dataMode,
      failedSymbols,
    });
  }, [
    allScannedCandidates,
    riskConfig,
    availableCashINR,
    openPositionsCount,
    macroRegime,
    newsItems,
    dataMode,
    marketStatus.isOpen,
    failedSymbols,
  ]);

  // Alert emission when top opportunity qualifies (Deduplicated)
  useEffect(() => {
    if (decisionResult.verdict === 'STRONG_QUALIFIED_SETUP' && decisionResult.topOpportunity) {
      const top = decisionResult.topOpportunity;
      const alertKey = `${top.candidate.symbol}_${top.candidate.setupType}_${top.candidate.signalTimestamp}`;

      if (!alertedSetupsRef.current.has(alertKey)) {
        alertedSetupsRef.current.add(alertKey);
        setActiveAlert({
          id: alertKey,
          title: `New Qualified Trade Signal: ${top.candidate.symbol}`,
          message: `${top.candidate.setupType.replace(/_/g, ' ')} (${top.candidate.direction}) triggered at ₹${top.candidate.entryTriggerPrice.toFixed(2)}. Net R:R ${top.candidate.netRewardRiskRatio.toFixed(2)}:1, Score ${top.totalScore}/100.`,
        });
      }
    }
  }, [decisionResult]);

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
      {/* Alert Banner if new qualified setup detected */}
      {activeAlert && (
        <div className="p-4 bg-emerald-950/80 border-2 border-emerald-500 rounded-2xl flex items-start justify-between gap-3 shadow-lg shadow-emerald-950/50 animate-pulse">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-xl mt-0.5">
              <Bell className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-emerald-300">{activeAlert.title}</h4>
              <p className="text-xs text-emerald-200/90 mt-0.5">{activeAlert.message}</p>
            </div>
          </div>
          <button
            onClick={() => setActiveAlert(null)}
            className="text-xs font-mono text-emerald-400 hover:text-white px-2 py-1 rounded bg-emerald-900/60"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Top Banner: Mode & Status Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-slate-900 border border-slate-800 rounded-2xl">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-cyan-500/10 border border-cyan-500/20 rounded-xl text-cyan-400">
            <Radar className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
              <span>Automatic Universe Scanner & Decision Engine</span>
              {dataMode === 'LIVE_MARKET' ? (
                <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-full border bg-emerald-500/10 text-emerald-400 border-emerald-500/30 flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping inline-block" />
                  LIVE DATA (YAHOO 15M DELAY)
                </span>
              ) : (
                <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-full border bg-purple-500/10 text-purple-300 border-purple-500/30">
                  DEMO TEST FIXTURE (OFFLINE)
                </span>
              )}
            </h2>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400 mt-1">
              <span>Exchange: <strong className="text-slate-300">NSE India</strong></span>
              <span>•</span>
              <span>Market Status: <strong className={marketStatus.isOpen ? 'text-emerald-400' : 'text-amber-400'}>{marketStatus.label}</strong></span>
              <span>•</span>
              <span>Last Scan: <strong className="text-slate-300 font-mono">{lastScanTimestampIST}</strong></span>
            </div>
          </div>
        </div>

        {/* Action Controls & Data Mode Switch */}
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          {/* Data Mode Switch */}
          <div className="bg-slate-950 p-1 rounded-xl border border-slate-800 flex items-center gap-1">
            <button
              onClick={() => setDataMode('LIVE_MARKET')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition flex items-center gap-1.5 ${
                dataMode === 'LIVE_MARKET'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Radio className="w-3 h-3" /> Live Market
            </button>
            <button
              onClick={() => setDataMode('DEMO_FIXTURE')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition ${
                dataMode === 'DEMO_FIXTURE'
                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Demo Fixture
            </button>
          </div>

          {/* View Switch: Universe vs Single */}
          <div className="bg-slate-950 p-1 rounded-xl border border-slate-800 flex items-center gap-1">
            <button
              onClick={() => setScannerMode('UNIVERSE')}
              className={`px-2.5 py-1 text-xs font-bold rounded-lg transition ${
                scannerMode === 'UNIVERSE'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Universe ({universeList.length})
            </button>
            <button
              onClick={() => setScannerMode('SINGLE')}
              className={`px-2.5 py-1 text-xs font-bold rounded-lg transition ${
                scannerMode === 'SINGLE'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Single
            </button>
          </div>
        </div>
      </div>

      {/* Cadence & Freshness Transparency Bar */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3 bg-slate-950 border border-slate-800/80 rounded-xl text-xs">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-cyan-400 shrink-0" />
          <div>
            <span className="text-slate-400 block text-[11px]">Scan Interval:</span>
            <span className="font-mono font-bold text-slate-200">
              {isAutoScanEnabled && (marketStatus.isOpen || dataMode === 'DEMO_FIXTURE')
                ? `60s cycle (Next in ${nextScanSeconds}s)`
                : `Paused (${marketStatus.label})`}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Info className="w-4 h-4 text-amber-400 shrink-0" />
          <div>
            <span className="text-slate-400 block text-[11px]">Provider Update Frequency:</span>
            <span className="font-mono text-slate-200">
              {dataMode === 'LIVE_MARKET' ? '15m delayed (Yahoo Free)' : 'Instant (Deterministic)'}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <div>
            <span className="text-slate-400 block text-[11px]">Auto-Scan Loop:</span>
            <span className="font-mono text-slate-200 font-semibold">
              {isAutoScanEnabled ? 'Active (09:15–15:30 IST)' : 'Disabled by User'}
            </span>
          </div>
          <button
            onClick={() => setIsAutoScanEnabled(!isAutoScanEnabled)}
            className={`px-2.5 py-1 text-[11px] font-bold rounded-lg border transition ${
              isAutoScanEnabled
                ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                : 'bg-emerald-600/20 text-emerald-400 border-emerald-500/40'
            }`}
          >
            {isAutoScanEnabled ? 'Pause Loop' : 'Enable 60s Loop'}
          </button>
        </div>
      </div>

      {/* Context Feeds Status: Real Macro and Real News */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 bg-slate-900/60 border border-slate-800 rounded-xl text-xs text-slate-400">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-cyan-400" />
          <span>Macro Context: <strong className="text-slate-200 font-mono">{macroFreshnessInfo}</strong></span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-indigo-400" />
          <span>News Intelligence: <strong className="text-slate-200 font-mono">{newsFreshnessInfo}</strong></span>
        </div>
        <button
          onClick={loadContextData}
          className="text-cyan-400 hover:text-cyan-300 text-[11px] flex items-center gap-1 ml-auto"
        >
          <RefreshCw className="w-3 h-3" /> Refresh Feeds
        </button>
      </div>

      {/* Failed / Excluded Symbols Drawer (Honest Disclosure of Provider Limits) */}
      {failedSymbols.length > 0 && (
        <div className="p-3 bg-amber-950/20 border border-amber-900/40 rounded-xl text-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-amber-400 font-bold flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4" />
              <span>{failedSymbols.length} Instrument(s) Excluded from Live Scan (Provider / Freshness Limits)</span>
            </span>
            <button
              onClick={() => setShowFailedSymbols(!showFailedSymbols)}
              className="text-amber-300 underline text-[11px]"
            >
              {showFailedSymbols ? 'Hide Details' : 'View Excluded Symbols'}
            </button>
          </div>
          {showFailedSymbols && (
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1 border-t border-amber-900/30 font-mono text-[11px] text-amber-200/80">
              {failedSymbols.map((f, i) => (
                <li key={i} className="flex items-start gap-1">
                  <strong className="text-amber-300">{f.symbol}:</strong>
                  <span className="truncate">{f.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* TOP DECISION PLAN CARD (Primary Support Output: Top Setup or NO TRADE) */}
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
                <span>{isScanning ? 'Scanning Universe...' : 'Scan Now (Manual Trigger)'}</span>
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
                <div>
                  <span className="font-bold text-slate-200">Custom Universe Manager</span>
                  <p className="text-[11px] text-slate-400">{UNIVERSE_COVERAGE_METADATA.limitationsDisclosure}</p>
                </div>
                <button
                  onClick={() => {
                    universeMgr.resetToDefault();
                    setUniverseList(universeMgr.getAllInstruments());
                  }}
                  className="text-slate-400 hover:text-rose-400 text-[11px] underline shrink-0"
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
                  className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono"
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
                        title="Remove custom symbol"
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

      {/* SINGLE ASSET SELECTOR */}
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
