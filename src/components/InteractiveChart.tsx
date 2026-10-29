/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  TrendingUp,
  Clock,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  Database,
  Eye,
  EyeOff,
  Star,
  RefreshCw,
  Activity,
  Layers,
  ChevronDown,
  Info,
  Maximize2,
} from 'lucide-react';
import {
  SUPPORTED_INSTRUMENTS,
  InstrumentConfig,
  formatINR,
  formatVolume,
} from '../services/marketDataProvider.ts';
import {
  HistoricalRange,
  HistoricalSeries,
  HistoricalCandle,
  defaultHistoricalProvider,
  extractIndicatorInputPrices,
} from '../services/historicalData.ts';
import {
  calculateSMA,
  calculateRSI,
  calculateMACD,
  MACDResult,
} from '../utils/indicators.ts';
import { useWatchlist } from '../utils/watchlist.ts';

interface InteractiveChartProps {
  initialSymbol?: string;
  onSymbolSelect?: (symbol: string) => void;
}

export function InteractiveChart({ initialSymbol = '^NSEI', onSymbolSelect }: InteractiveChartProps) {
  const [selectedSymbol, setSelectedSymbol] = useState<string>(initialSymbol);
  const [selectedRange, setSelectedRange] = useState<HistoricalRange>('1y');
  const [historicalData, setHistoricalData] = useState<HistoricalSeries | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Indicator toggle state
  const [showSMA20, setShowSMA20] = useState<boolean>(true);
  const [showSMA50, setShowSMA50] = useState<boolean>(true);
  const [showRSI, setShowRSI] = useState<boolean>(true);
  const [showMACD, setShowMACD] = useState<boolean>(true);

  // Crosshair / Hover state
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Watchlist integration
  const { isInWatchlist, toggleSymbol } = useWatchlist();

  // Load historical data whenever symbol or range changes
  const loadData = useCallback(async (symbol: string, range: HistoricalRange, force = false) => {
    setLoading(true);
    setError(null);
    try {
      const data = await defaultHistoricalProvider.getHistoricalData(symbol, range, force);
      setHistoricalData(data);
      // Default hover to the latest candle
      if (data.candles.length > 0) {
        setHoverIndex(data.candles.length - 1);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load historical data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData(selectedSymbol, selectedRange);
  }, [selectedSymbol, selectedRange, loadData]);

  // Handle symbol change
  const handleSelectSymbol = (sym: string) => {
    setSelectedSymbol(sym);
    if (onSymbolSelect) onSymbolSelect(sym);
  };

  // Extract raw closes for indicator calculations (invalid/missing candles strictly mapped to null)
  const rawCloses = useMemo(() => {
    return extractIndicatorInputPrices(historicalData);
  }, [historicalData]);

  // Calculate indicators deterministically
  const sma20Series = useMemo(() => {
    if (!showSMA20 || rawCloses.length === 0) return [];
    return calculateSMA(rawCloses, 20);
  }, [showSMA20, rawCloses]);

  const sma50Series = useMemo(() => {
    if (!showSMA50 || rawCloses.length === 0) return [];
    return calculateSMA(rawCloses, 50);
  }, [showSMA50, rawCloses]);

  const rsiSeries = useMemo(() => {
    if (!showRSI || rawCloses.length === 0) return [];
    return calculateRSI(rawCloses, 14);
  }, [showRSI, rawCloses]);

  const macdSeries = useMemo<MACDResult>(() => {
    if (!showMACD || rawCloses.length === 0) {
      return { macd: [], signal: [], histogram: [] };
    }
    return calculateMACD(rawCloses, 12, 26, 9);
  }, [showMACD, rawCloses]);

  // Compute coordinate geometry for SVG charts
  const chartLayout = useMemo(() => {
    if (!historicalData || historicalData.candles.length === 0) return null;

    const candles = historicalData.candles;
    const n = candles.length;
    if (n < 2) return null;

    // ViewBox dimensions
    const width = 800;
    const priceHeight = 240;
    const rsiHeight = showRSI ? 80 : 0;
    const macdHeight = showMACD ? 90 : 0;
    const paddingX = 40;
    const paddingTop = 20;
    const paddingBottom = 30;

    // Filter valid close prices and indicators for scale
    const validCloses = candles.map((c) => c.close).filter((p): p is number => p !== null);
    if (validCloses.length === 0) return null;

    let minPrice = Math.min(...validCloses);
    let maxPrice = Math.max(...validCloses);

    // Expand min/max with visible SMA values
    if (showSMA20) {
      sma20Series.forEach((v) => {
        if (v !== null) {
          if (v < minPrice) minPrice = v;
          if (v > maxPrice) maxPrice = v;
        }
      });
    }
    if (showSMA50) {
      sma50Series.forEach((v) => {
        if (v !== null) {
          if (v < minPrice) minPrice = v;
          if (v > maxPrice) maxPrice = v;
        }
      });
    }

    // Add 4% buffer so line doesn't stick to edge
    const priceRange = maxPrice - minPrice || 1;
    const yMin = minPrice - priceRange * 0.04;
    const yMax = maxPrice + priceRange * 0.04;

    const getX = (idx: number) => {
      return paddingX + (idx / (n - 1)) * (width - 2 * paddingX);
    };

    const getYPrice = (val: number | null) => {
      if (val === null) return null;
      const normalized = (val - yMin) / (yMax - yMin);
      return paddingTop + (1 - normalized) * (priceHeight - paddingTop - 10);
    };

    // Build Price path segments (handling missing candles as gaps)
    const priceSegments: { path: string; isMissing: boolean }[] = [];
    let currentPath = '';

    for (let i = 0; i < n; i++) {
      const c = candles[i];
      const x = getX(i);
      const y = getYPrice(c.close);

      if (y !== null) {
        if (!currentPath) {
          currentPath = `M ${x.toFixed(1)} ${y.toFixed(1)}`;
        } else {
          currentPath += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
        }
      } else {
        if (currentPath) {
          priceSegments.push({ path: currentPath, isMissing: false });
          currentPath = '';
        }
      }
    }
    if (currentPath) {
      priceSegments.push({ path: currentPath, isMissing: false });
    }

    // Build Area gradient path
    let areaPath = '';
    if (priceSegments.length > 0) {
      const firstValidIdx = candles.findIndex((c) => c.close !== null);
      let lastValidIdx = -1;
      for (let i = candles.length - 1; i >= 0; i--) {
        if (candles[i].close !== null) {
          lastValidIdx = i;
          break;
        }
      }
      if (firstValidIdx >= 0 && lastValidIdx >= 0 && firstValidIdx <= lastValidIdx) {
        const xStart = getX(firstValidIdx);
        const xEnd = getX(lastValidIdx);
        const yBottom = priceHeight;

        let points = '';
        for (let i = firstValidIdx; i <= lastValidIdx; i++) {
          const y = getYPrice(candles[i].close);
          if (y !== null) {
            points += ` L ${getX(i).toFixed(1)} ${y.toFixed(1)}`;
          }
        }
        if (points) {
          areaPath = `M ${xStart.toFixed(1)} ${yBottom} ${points} L ${xEnd.toFixed(1)} ${yBottom} Z`;
        }
      }
    }

    // Build SMA paths
    const buildIndicatorPath = (series: (number | null)[]) => {
      const segs: string[] = [];
      let cur = '';
      for (let i = 0; i < n; i++) {
        const val = series[i];
        const y = getYPrice(val);
        const x = getX(i);
        if (y !== null) {
          if (!cur) cur = `M ${x.toFixed(1)} ${y.toFixed(1)}`;
          else cur += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
        } else {
          if (cur) {
            segs.push(cur);
            cur = '';
          }
        }
      }
      if (cur) segs.push(cur);
      return segs;
    };

    const sma20Paths = showSMA20 ? buildIndicatorPath(sma20Series) : [];
    const sma50Paths = showSMA50 ? buildIndicatorPath(sma50Series) : [];

    // RSI sub-chart coordinates
    const rsiTop = priceHeight + 15;
    const rsiInnerHeight = 60;
    const getYRSI = (val: number | null) => {
      if (val === null) return null;
      return rsiTop + (1 - val / 100) * rsiInnerHeight;
    };
    const rsiPaths: string[] = [];
    if (showRSI) {
      let curRSI = '';
      for (let i = 0; i < n; i++) {
        const val = rsiSeries[i];
        const y = getYRSI(val);
        const x = getX(i);
        if (y !== null) {
          if (!curRSI) curRSI = `M ${x.toFixed(1)} ${y.toFixed(1)}`;
          else curRSI += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
        } else {
          if (curRSI) {
            rsiPaths.push(curRSI);
            curRSI = '';
          }
        }
      }
      if (curRSI) rsiPaths.push(curRSI);
    }

    // MACD sub-chart coordinates
    const macdTop = (showRSI ? rsiTop + rsiInnerHeight + 25 : priceHeight + 15);
    const macdInnerHeight = 70;

    // MACD min/max
    const validMACDs = [
      ...macdSeries.macd.filter((v): v is number => v !== null),
      ...macdSeries.signal.filter((v): v is number => v !== null),
      ...macdSeries.histogram.filter((v): v is number => v !== null),
    ];
    let maxMacdAbs = 1;
    if (validMACDs.length > 0) {
      maxMacdAbs = Math.max(...validMACDs.map((v) => Math.abs(v))) || 1;
    }
    const macdZeroY = macdTop + macdInnerHeight / 2;

    const getYMACD = (val: number | null) => {
      if (val === null) return null;
      return macdZeroY - (val / (maxMacdAbs * 1.1)) * (macdInnerHeight / 2);
    };

    const macdLinePaths: string[] = [];
    const signalLinePaths: string[] = [];
    if (showMACD) {
      let curM = '';
      let curS = '';
      for (let i = 0; i < n; i++) {
        const x = getX(i);
        const yM = getYMACD(macdSeries.macd[i]);
        const yS = getYMACD(macdSeries.signal[i]);
        if (yM !== null) {
          if (!curM) curM = `M ${x.toFixed(1)} ${yM.toFixed(1)}`;
          else curM += ` L ${x.toFixed(1)} ${yM.toFixed(1)}`;
        } else if (curM) {
          macdLinePaths.push(curM);
          curM = '';
        }

        if (yS !== null) {
          if (!curS) curS = `M ${x.toFixed(1)} ${yS.toFixed(1)}`;
          else curS += ` L ${x.toFixed(1)} ${yS.toFixed(1)}`;
        } else if (curS) {
          signalLinePaths.push(curS);
          curS = '';
        }
      }
      if (curM) macdLinePaths.push(curM);
      if (curS) signalLinePaths.push(curS);
    }

    const totalHeight = showMACD
      ? macdTop + macdInnerHeight + paddingBottom
      : showRSI
      ? rsiTop + rsiInnerHeight + paddingBottom
      : priceHeight + paddingBottom;

    return {
      width,
      totalHeight,
      priceHeight,
      paddingX,
      paddingTop,
      yMin,
      yMax,
      getX,
      getYPrice,
      priceSegments,
      areaPath,
      sma20Paths,
      sma50Paths,
      showRSI,
      rsiTop,
      rsiInnerHeight,
      getYRSI,
      rsiPaths,
      showMACD,
      macdTop,
      macdInnerHeight,
      macdZeroY,
      getYMACD,
      macdLinePaths,
      signalLinePaths,
    };
  }, [historicalData, showSMA20, showSMA50, showRSI, showMACD, sma20Series, sma50Series, rsiSeries, macdSeries]);

  // Handle pointer scrub / touch for mobile and desktop
  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!svgRef.current || !historicalData || historicalData.candles.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clientX / rect.width));
    const idx = Math.round(ratio * (historicalData.candles.length - 1));
    setHoverIndex(idx);
  };

  const currentHoverCandle: HistoricalCandle | null = useMemo(() => {
    if (!historicalData || hoverIndex === null) return null;
    return historicalData.candles[hoverIndex] || null;
  }, [historicalData, hoverIndex]);

  const currentHoverSMA20 = hoverIndex !== null ? sma20Series[hoverIndex] : null;
  const currentHoverSMA50 = hoverIndex !== null ? sma50Series[hoverIndex] : null;
  const currentHoverRSI = hoverIndex !== null ? rsiSeries[hoverIndex] : null;
  const currentHoverMACD = hoverIndex !== null && macdSeries.macd ? macdSeries.macd[hoverIndex] : null;
  const currentHoverSignal = hoverIndex !== null && macdSeries.signal ? macdSeries.signal[hoverIndex] : null;
  const currentHoverHist = hoverIndex !== null && macdSeries.histogram ? macdSeries.histogram[hoverIndex] : null;

  const currentInst = SUPPORTED_INSTRUMENTS.find((i) => i.symbol === selectedSymbol);
  const inWatchlist = isInWatchlist(selectedSymbol);

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5 shadow-lg">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-cyan-950/80 text-cyan-400 border border-cyan-800/60">
                <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
                Stage 3: Interactive Charts & Indicators
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700">
                <Database className="w-3 h-3 text-cyan-400" />
                Yahoo Finance v8 Chart
              </span>
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold ${
                  historicalData?.freshnessStatus === 'LIVE_SESSION'
                    ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                    : 'bg-amber-950/80 text-amber-300 border border-amber-800'
                }`}
              >
                {historicalData?.freshnessStatus === 'LIVE_SESSION' ? 'SESSION ACTIVE' : 'CLOSED (EOD)'}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight flex items-center gap-2">
                {currentInst?.name || selectedSymbol}
                <span className="text-xs font-mono font-normal text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded">
                  {selectedSymbol}
                </span>
              </h2>
              <button
                onClick={() => toggleSymbol(selectedSymbol)}
                aria-label={inWatchlist ? `Remove ${selectedSymbol} from Watchlist` : `Add ${selectedSymbol} to Watchlist`}
                className={`p-1.5 rounded-lg border transition-all ${
                  inWatchlist
                    ? 'bg-amber-500/10 border-amber-500/50 text-amber-400'
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                }`}
              >
                <Star className={`w-4 h-4 ${inWatchlist ? 'fill-amber-400' : ''}`} />
              </button>
            </div>
            <p className="text-xs text-slate-400">
              Interactive historical prices, non-fabricated candles, and pure mathematical indicators (SMA 20, SMA 50, RSI 14, MACD).
            </p>
          </div>

          {/* Time Range Selector & Refresh */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex bg-slate-950/80 p-1 rounded-lg border border-slate-800">
              {(['5d', '1mo', '3mo', '6mo', '1y', '5y'] as HistoricalRange[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setSelectedRange(r)}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    selectedRange === r
                      ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                  }`}
                >
                  {r.toUpperCase()}
                </button>
              ))}
            </div>

            <button
              onClick={() => loadData(selectedSymbol, selectedRange, true)}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-750 text-slate-200 text-xs font-medium rounded-lg border border-slate-700 hover:border-slate-600 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-cyan-400' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        </div>

        {/* Instrument Selector Pill Row */}
        <div className="mt-4 pt-4 border-t border-slate-800 flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin">
          <span className="text-xs text-slate-500 font-medium whitespace-nowrap pl-0.5">Instruments:</span>
          {SUPPORTED_INSTRUMENTS.map((inst) => {
            const isSelected = inst.symbol === selectedSymbol;
            const inWl = isInWatchlist(inst.symbol);
            return (
              <button
                key={inst.symbol}
                onClick={() => handleSelectSymbol(inst.symbol)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all whitespace-nowrap border ${
                  isSelected
                    ? 'bg-cyan-950 border-cyan-500/80 text-cyan-300 shadow-sm'
                    : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700 hover:text-white'
                }`}
              >
                {inWl && <Star className="w-2.5 h-2.5 fill-amber-400 text-amber-400" />}
                <span>{inst.name}</span>
                <span className="text-[10px] text-slate-500 uppercase">{inst.exchange}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Indicator Controls & Scrub Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          {/* Toggles */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-400 font-medium">Overlays & Oscillators:</span>
            <button
              onClick={() => setShowSMA20(!showSMA20)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                showSMA20
                  ? 'bg-cyan-950/80 border-cyan-500/70 text-cyan-400'
                  : 'bg-slate-800/40 border-slate-800 text-slate-500 hover:text-slate-300'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
              SMA 20
            </button>

            <button
              onClick={() => setShowSMA50(!showSMA50)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                showSMA50
                  ? 'bg-amber-950/80 border-amber-500/70 text-amber-400'
                  : 'bg-slate-800/40 border-slate-800 text-slate-500 hover:text-slate-300'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-amber-400"></span>
              SMA 50
            </button>

            <button
              onClick={() => setShowRSI(!showRSI)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                showRSI
                  ? 'bg-purple-950/80 border-purple-500/70 text-purple-400'
                  : 'bg-slate-800/40 border-slate-800 text-slate-500 hover:text-slate-300'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-purple-400"></span>
              RSI (14)
            </button>

            <button
              onClick={() => setShowMACD(!showMACD)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                showMACD
                  ? 'bg-emerald-950/80 border-emerald-500/70 text-emerald-400'
                  : 'bg-slate-800/40 border-slate-800 text-slate-500 hover:text-slate-300'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
              MACD (12, 26, 9)
            </button>
          </div>

          {/* Scrubber Tooltip Summary */}
          {currentHoverCandle && (
            <div className="flex flex-wrap items-center gap-3 text-xs font-mono bg-slate-950/90 px-3 py-1.5 rounded-lg border border-slate-800">
              <span className="text-slate-400 flex items-center gap-1">
                <Calendar className="w-3 h-3 text-slate-500" />
                {currentHoverCandle.dateString}
              </span>
              {currentHoverCandle.isMissing ? (
                <span className="text-amber-400 font-bold bg-amber-950/80 px-1.5 py-0.5 rounded">
                  MISSING CANDLE
                </span>
              ) : (
                <>
                  <span className="text-white font-bold">
                    C: {formatINR(currentHoverCandle.close)}
                  </span>
                  {currentHoverCandle.open && (
                    <span className="text-slate-400 hidden sm:inline">
                      O: {currentHoverCandle.open.toFixed(2)}
                    </span>
                  )}
                  {currentHoverCandle.high && (
                    <span className="text-emerald-400 hidden sm:inline">
                      H: {currentHoverCandle.high.toFixed(2)}
                    </span>
                  )}
                  {currentHoverCandle.low && (
                    <span className="text-rose-400 hidden sm:inline">
                      L: {currentHoverCandle.low.toFixed(2)}
                    </span>
                  )}
                  {showSMA20 && (
                    <span className="text-cyan-400">
                      SMA20: {currentHoverSMA20 !== null ? currentHoverSMA20.toFixed(2) : 'N/A'}
                    </span>
                  )}
                  {showSMA50 && (
                    <span className="text-amber-400">
                      SMA50: {currentHoverSMA50 !== null ? currentHoverSMA50.toFixed(2) : 'N/A'}
                    </span>
                  )}
                  {showRSI && (
                    <span className="text-purple-400">
                      RSI: {currentHoverRSI !== null ? currentHoverRSI.toFixed(1) : 'N/A'}
                    </span>
                  )}
                  {showMACD && currentHoverMACD !== null && (
                    <span className="text-emerald-400">
                      MACD: {currentHoverMACD.toFixed(2)}
                    </span>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Main Chart Canvas / SVG Container */}
        <div className="mt-4 relative bg-slate-950 rounded-lg p-2 sm:p-4 border border-slate-800/80 overflow-hidden select-none">
          {loading && (
            <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center z-20">
              <div className="flex flex-col items-center gap-2">
                <RefreshCw className="w-8 h-8 text-cyan-400 animate-spin" />
                <span className="text-xs text-slate-300 font-medium">Fetching authentic candles from Yahoo Chart API...</span>
              </div>
            </div>
          )}

          {error && (
            <div className="p-6 text-center">
              <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto mb-2" />
              <p className="text-sm text-red-400 font-medium mb-1">{error}</p>
              <button
                onClick={() => loadData(selectedSymbol, selectedRange, true)}
                className="mt-3 px-3 py-1 bg-slate-800 text-xs text-slate-200 rounded border border-slate-700 hover:bg-slate-700"
              >
                Retry Request
              </button>
            </div>
          )}

          {!error && chartLayout && historicalData && (
            <div className="w-full overflow-x-auto touch-pan-x">
              <svg
                ref={svgRef}
                viewBox={`0 0 ${chartLayout.width} ${chartLayout.totalHeight}`}
                className="w-full h-auto min-w-[550px] cursor-crosshair"
                onPointerMove={handlePointerMove}
                onPointerLeave={() => {
                  if (historicalData.candles.length > 0) {
                    setHoverIndex(historicalData.candles.length - 1);
                  }
                }}
              >
                <defs>
                  <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.35" />
                    <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.0" />
                  </linearGradient>
                  <pattern id="missingPattern" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                    <line x1="0" y1="0" x2="0" y2="6" stroke="#f59e0b" strokeWidth="1.5" />
                  </pattern>
                </defs>

                {/* Grid Lines for Price Chart */}
                {[0.2, 0.4, 0.6, 0.8].map((ratio) => {
                  const y = chartLayout.paddingTop + ratio * (chartLayout.priceHeight - chartLayout.paddingTop);
                  const priceAtLevel = chartLayout.yMax - ratio * (chartLayout.yMax - chartLayout.yMin);
                  return (
                    <g key={ratio}>
                      <line
                        x1={chartLayout.paddingX}
                        y1={y}
                        x2={chartLayout.width - chartLayout.paddingX}
                        y2={y}
                        stroke="#1e293b"
                        strokeDasharray="3 3"
                        strokeWidth="1"
                      />
                      <text
                        x={chartLayout.width - chartLayout.paddingX + 6}
                        y={y + 3}
                        fill="#64748b"
                        fontSize="9"
                        fontFamily="monospace"
                      >
                        {priceAtLevel >= 1000 ? priceAtLevel.toFixed(0) : priceAtLevel.toFixed(1)}
                      </text>
                    </g>
                  );
                })}

                {/* Area Gradient */}
                {chartLayout.areaPath && (
                  <path d={chartLayout.areaPath} fill="url(#chartGradient)" />
                )}

                {/* Main Price Line */}
                {chartLayout.priceSegments.map((seg, idx) => (
                  <path
                    key={`pseg-${idx}`}
                    d={seg.path}
                    fill="none"
                    stroke="#22d3ee"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ))}

                {/* SMA 20 Overlay Line (Cyan) */}
                {showSMA20 &&
                  chartLayout.sma20Paths.map((p, idx) => (
                    <path
                      key={`sma20-${idx}`}
                      d={p}
                      fill="none"
                      stroke="#38bdf8"
                      strokeWidth="1.5"
                      strokeDasharray="4 2"
                    />
                  ))}

                {/* SMA 50 Overlay Line (Amber) */}
                {showSMA50 &&
                  chartLayout.sma50Paths.map((p, idx) => (
                    <path
                      key={`sma50-${idx}`}
                      d={p}
                      fill="none"
                      stroke="#fbbf24"
                      strokeWidth="1.5"
                      strokeDasharray="5 3"
                    />
                  ))}

                {/* Missing Candle Markers on Main Chart */}
                {historicalData.candles.map((c, i) => {
                  if (!c.isMissing) return null;
                  const x = chartLayout.getX(i);
                  return (
                    <g key={`missing-${i}`}>
                      <line
                        x1={x}
                        y1={chartLayout.paddingTop}
                        x2={x}
                        y2={chartLayout.priceHeight}
                        stroke="#f59e0b"
                        strokeDasharray="2 2"
                        strokeWidth="1.5"
                      />
                      <circle cx={x} cy={chartLayout.priceHeight / 2} r="3" fill="#f59e0b" />
                    </g>
                  );
                })}

                {/* Sub-chart: RSI Panel */}
                {chartLayout.showRSI && (
                  <g className="rsi-panel">
                    {/* RSI Header & Separator */}
                    <line
                      x1={chartLayout.paddingX}
                      y1={chartLayout.rsiTop - 8}
                      x2={chartLayout.width - chartLayout.paddingX}
                      y2={chartLayout.rsiTop - 8}
                      stroke="#334155"
                      strokeWidth="1"
                    />
                    <text
                      x={chartLayout.paddingX}
                      y={chartLayout.rsiTop - 1}
                      fill="#a855f7"
                      fontSize="10"
                      fontWeight="bold"
                    >
                      RSI (14)
                    </text>

                    {/* 70 Overbought and 30 Oversold Guidelines */}
                    <line
                      x1={chartLayout.paddingX}
                      y1={chartLayout.getYRSI(70)!}
                      x2={chartLayout.width - chartLayout.paddingX}
                      y2={chartLayout.getYRSI(70)!}
                      stroke="#475569"
                      strokeDasharray="3 3"
                      strokeWidth="1"
                    />
                    <text
                      x={chartLayout.width - chartLayout.paddingX + 6}
                      y={chartLayout.getYRSI(70)! + 3}
                      fill="#64748b"
                      fontSize="8"
                      fontFamily="monospace"
                    >
                      70
                    </text>

                    <line
                      x1={chartLayout.paddingX}
                      y1={chartLayout.getYRSI(30)!}
                      x2={chartLayout.width - chartLayout.paddingX}
                      y2={chartLayout.getYRSI(30)!}
                      stroke="#475569"
                      strokeDasharray="3 3"
                      strokeWidth="1"
                    />
                    <text
                      x={chartLayout.width - chartLayout.paddingX + 6}
                      y={chartLayout.getYRSI(30)! + 3}
                      fill="#64748b"
                      fontSize="8"
                      fontFamily="monospace"
                    >
                      30
                    </text>

                    {/* RSI Curve */}
                    {chartLayout.rsiPaths.map((p, idx) => (
                      <path
                        key={`rsi-${idx}`}
                        d={p}
                        fill="none"
                        stroke="#c084fc"
                        strokeWidth="1.5"
                      />
                    ))}
                  </g>
                )}

                {/* Sub-chart: MACD Panel */}
                {chartLayout.showMACD && (
                  <g className="macd-panel">
                    <line
                      x1={chartLayout.paddingX}
                      y1={chartLayout.macdTop - 8}
                      x2={chartLayout.width - chartLayout.paddingX}
                      y2={chartLayout.macdTop - 8}
                      stroke="#334155"
                      strokeWidth="1"
                    />
                    <text
                      x={chartLayout.paddingX}
                      y={chartLayout.macdTop - 1}
                      fill="#10b981"
                      fontSize="10"
                      fontWeight="bold"
                    >
                      MACD (12, 26, 9)
                    </text>

                    {/* Zero Line */}
                    <line
                      x1={chartLayout.paddingX}
                      y1={chartLayout.macdZeroY}
                      x2={chartLayout.width - chartLayout.paddingX}
                      y2={chartLayout.macdZeroY}
                      stroke="#475569"
                      strokeDasharray="2 2"
                      strokeWidth="1"
                    />

                    {/* MACD Histogram Bars */}
                    {macdSeries.histogram.map((h, i) => {
                      if (h === null) return null;
                      const x = chartLayout.getX(i);
                      const yH = chartLayout.getYMACD(h)!;
                      const barTop = Math.min(yH, chartLayout.macdZeroY);
                      const barHeight = Math.abs(yH - chartLayout.macdZeroY);
                      return (
                        <rect
                          key={`hist-${i}`}
                          x={x - 1.2}
                          y={barTop}
                          width="2.4"
                          height={Math.max(1, barHeight)}
                          fill={h >= 0 ? '#10b981' : '#f43f5e'}
                          opacity="0.75"
                        />
                      );
                    })}

                    {/* MACD Line */}
                    {chartLayout.macdLinePaths.map((p, idx) => (
                      <path
                        key={`macdl-${idx}`}
                        d={p}
                        fill="none"
                        stroke="#34d399"
                        strokeWidth="1.5"
                      />
                    ))}

                    {/* Signal Line */}
                    {chartLayout.signalLinePaths.map((p, idx) => (
                      <path
                        key={`signall-${idx}`}
                        d={p}
                        fill="none"
                        stroke="#f87171"
                        strokeWidth="1.5"
                        strokeDasharray="3 2"
                      />
                    ))}
                  </g>
                )}

                {/* Crosshair Cursor & Indicator Dots */}
                {hoverIndex !== null && currentHoverCandle && (
                  <g className="crosshair-indicator">
                    <line
                      x1={chartLayout.getX(hoverIndex)}
                      y1={chartLayout.paddingTop}
                      x2={chartLayout.getX(hoverIndex)}
                      y2={chartLayout.totalHeight - 15}
                      stroke="#94a3b8"
                      strokeWidth="1"
                      strokeDasharray="2 2"
                      opacity="0.8"
                    />

                    {/* Price Marker Dot */}
                    {currentHoverCandle.close !== null && (
                      <circle
                        cx={chartLayout.getX(hoverIndex)}
                        cy={chartLayout.getYPrice(currentHoverCandle.close)!}
                        r="4"
                        fill="#22d3ee"
                        stroke="#0f172a"
                        strokeWidth="2"
                      />
                    )}

                    {/* Date label at bottom of crosshair */}
                    <rect
                      x={chartLayout.getX(hoverIndex) - 30}
                      y={chartLayout.totalHeight - 14}
                      width="60"
                      height="14"
                      rx="2"
                      fill="#0f172a"
                      stroke="#334155"
                    />
                    <text
                      x={chartLayout.getX(hoverIndex)}
                      y={chartLayout.totalHeight - 3}
                      fill="#cbd5e1"
                      fontSize="8"
                      fontFamily="monospace"
                      textAnchor="middle"
                    >
                      {currentHoverCandle.dateString.slice(5)}
                    </text>
                  </g>
                )}
              </svg>
            </div>
          )}

          {/* Missing Data Warning Alert if any missing candles or omitted verified trading sessions exist */}
          {historicalData && (historicalData.missingCandles > 0 || historicalData.missingSessionDates.length > 0) && (
            <div className="mt-3 p-2.5 rounded-lg bg-amber-950/60 border border-amber-800/80 flex items-start gap-2 text-xs text-amber-200">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                {historicalData.missingCandles > 0 && (
                  <div>
                    <span className="font-bold">Missing / Invalid Candles in Payload: </span>
                    <span>
                      {historicalData.missingCandles} candle(s) had null or invalid OHLC values for dates [
                      {historicalData.missingDates.join(', ')}] (Holiday/Special Null Placeholder:{' '}
                      {historicalData.holidayOrSpecialNullCandles}, Calendar-Unverified Null:{' '}
                      {historicalData.unverifiedCalendarNullCandles}, Verified-Session Missing/Invalid:{' '}
                      {historicalData.genuinelyMissingTradingCandles}).
                      In strict compliance with Stage 3 data integrity rules, these gaps are rendered with dashed markers,
                      propagated as <code className="font-mono">null</code> into indicators, and are{' '}
                      <strong>NEVER fabricated or interpolated</strong>.
                    </span>
                  </div>
                )}
                {historicalData.missingSessionDates.length > 0 && (
                  <div>
                    <span className="font-bold">Genuinely Omitted Verified Trading Sessions: </span>
                    <span>
                      {historicalData.missingSessionDates.length} verified exchange trading session date(s) had no timestamp
                      entry in provider response: [{historicalData.missingSessionDates.slice(0, 8).join(', ')}
                      {historicalData.missingSessionDates.length > 8 ? '...' : ''}].
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Stage 3 Data Integrity & Audit Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5 shadow-lg">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2 mb-3">
          <Database className="w-4 h-4 text-cyan-400" />
          Data Integrity & Provenance Verification
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
          <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800/80">
            <span className="text-slate-400 block mb-1">Available Period:</span>
            <span className="font-mono text-white font-semibold">
              {historicalData ? `${historicalData.periodStart} to ${historicalData.periodEnd}` : 'N/A'}
            </span>
            <span className="text-[10px] text-slate-500 block mt-1">
              Range: {selectedRange.toUpperCase()} (1d Interval)
            </span>
          </div>

          <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800/80">
            <span className="text-slate-400 block mb-1">Candle & Calendar Audit:</span>
            <span className="font-mono text-white font-semibold">
              {historicalData ? `${historicalData.validCandles} / ${historicalData.totalCandles} valid` : '--'}
            </span>
            <span
              className={`text-[10px] block mt-1 font-medium ${
                historicalData?.genuinelyMissingTradingCandles === 0 &&
                historicalData?.missingSessionDates.length === 0
                  ? 'text-emerald-400'
                  : 'text-amber-400'
              }`}
            >
              {historicalData
                ? `${historicalData.missingCandles} null/invalid bar(s) · ${historicalData.missingSessionDates.length} missing verified session(s)`
                : '--'}
            </span>
          </div>

          <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800/80">
            <span className="text-slate-400 block mb-1">Latest Candle Status:</span>
            <span
              className="font-mono text-cyan-300 font-semibold block break-words"
              title={historicalData?.latestCandleFormationLabel || 'N/A'}
            >
              {historicalData?.latestCandleFormationLabel || 'N/A'}
            </span>
            <span className="text-[10px] text-slate-500 block mt-1">
              {historicalData?.latestCandleTimestampIST
                ? `Session: ${historicalData.latestCandleSessionDateIST} (${historicalData.latestCandleTimestampIST})`
                : 'Source time'}
            </span>
          </div>

          <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800/80">
            <span className="text-slate-400 block mb-1">Client Fetch Timestamp:</span>
            <span className="font-mono text-amber-300 font-semibold">
              {historicalData?.fetchTimestampIST || 'N/A'}
            </span>
            <span className="text-[10px] text-slate-500 block mt-1">
              {historicalData?.freshnessStatus === 'LIVE_SESSION'
                ? 'Intraday window active'
                : 'Outside regular session hours (official close unverified)'}
            </span>
          </div>
        </div>

        {/* Exchange Calendar Coverage Classification Banner (Stage 3.3) */}
        {historicalData && (
          <div className="mt-3 p-3 rounded-lg bg-slate-950/80 border border-slate-800 text-[11px] text-slate-300 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <span className="font-bold text-emerald-400">Exchange Calendar Classification: </span>
              <span>
                Verified calendar years: [{historicalData.verifiedCalendarYears.join(', ') || 'None'}] (Confirmed Holidays:{' '}
                {historicalData.confirmedHolidayDates.length}, Special Sessions: {historicalData.specialSessionDates.length}
                , Missing Verified Sessions: {historicalData.missingSessionDates.length}).
                {historicalData.unverifiedCalendarYears.length > 0 && (
                  <>
                    {' '}
                    Older/Provisional years [{historicalData.unverifiedCalendarYears.join(', ')}] are classified as{' '}
                    <code className="text-amber-300 font-mono">CALENDAR_UNVERIFIED</code> (
                    {historicalData.unverifiedCalendarDates.length} unobserved weekday(s) not assumed missing).
                  </>
                )}
              </span>
            </div>
            <span className="shrink-0 font-mono text-[10px] px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300">
              {historicalData.calendarCoverageStatus}
            </span>
          </div>
        )}

        {/* Split & Dividend Adjustment Disclosure Banner */}
        <div className="mt-3 p-3 rounded-lg bg-slate-950/80 border border-slate-800 text-[11px] text-slate-300 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <span className="font-bold text-cyan-400">Price Adjustment Basis: </span>
            <span>
              {historicalData?.priceAdjustmentDisclosure ||
                'Chart OHLC & indicator prices use Yahoo Finance indicators.quote[0] (split/bonus-adjusted, UNADJUSTED for cash dividends).'}
            </span>
          </div>
          {historicalData && (
            <span className="shrink-0 font-mono text-[10px] px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300">
              adjclose series: {historicalData.hasAdjCloseSeries ? 'PRESENT' : 'NONE'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
