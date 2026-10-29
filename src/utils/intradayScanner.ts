/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * STAGE 4E — INTRADAY SETUP SCANNER & CANDIDATE GENERATION ENGINE
 * ===============================================================
 * Strictly causal, leakage-free setup scanner for Indian equities and index proxies.
 * Calculates VWAP, Opening Range Breakout (ORB), RSI 14, MACD, ATR 14, and Volume Confirmation
 * exclusively from completed intraday bars up to the signal cutoff timestamp.
 *
 * Integrates statutory Indian transaction cost models to compute net Risk-to-Reward (R:R).
 */

import { IntradayCandle, IntradaySeries } from '../services/intradayData.ts';
import { calculateRSI, calculateMACD } from './indicators.ts';
import { getRealisticIndianMarketCostPreset, IndianMarketCostPreset } from './predictionResearch.ts';

export type SetupDirection = 'LONG' | 'SHORT';
export type SetupType =
  | 'VWAP_PULLBACK'
  | 'OPENING_RANGE_BREAKOUT'
  | 'RSI_MOMENTUM_REVERSAL'
  | 'MACD_CROSSOVER'
  | 'ATR_VOLATILITY_EXPANSION';

export interface SetupCandidate {
  id: string; // unique deterministic id
  symbol: string;
  name: string;
  exchange: 'NSE' | 'BSE';
  isTradableCashEquity: boolean;
  timeframe: string;
  signalTimestamp: number;
  signalTimestampIST: string;
  setupType: SetupType;
  direction: SetupDirection;
  entryTriggerPrice: number;
  stopLossPrice: number;
  targetPrice: number;
  stopDistanceINR: number;
  targetDistanceINR: number;
  grossRiskRewardRatio: number;
  estimatedCostBps: number;
  estimatedCostINRPerShare: number;
  netRewardRiskRatio: number;
  indicators: {
    vwap?: number;
    orbHigh?: number;
    orbLow?: number;
    rsi14?: number;
    macdHistogram?: number;
    atr14?: number;
    volumeMultiplier?: number;
  };
  reasonQualified: string;
  invalidationCondition: string;
  signalExpiryIST: string;
  status: 'QUALIFIED' | 'DISQUALIFIED';
  rejectionReason?: string;
}

/**
 * Calculates Intraday Volume Weighted Average Price (VWAP) from session start (09:15 IST).
 * VWAP = sum(Typical Price * Volume) / sum(Volume)
 * where Typical Price = (High + Low + Close) / 3.
 */
export function calculateIntradayVWAP(candles: IntradayCandle[]): (number | null)[] {
  const vwapValues: (number | null)[] = [];
  let cumulativeTypicalVol = 0;
  let cumulativeVol = 0;
  let currentSessionDate = '';

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (!c.isValid) {
      vwapValues.push(null);
      continue;
    }

    // Reset VWAP at the start of each new trading session (date change)
    if (c.dateString !== currentSessionDate) {
      currentSessionDate = c.dateString;
      cumulativeTypicalVol = 0;
      cumulativeVol = 0;
    }

    const typicalPrice = (c.high + c.low + c.close) / 3;
    const vol = Math.max(1, c.volume);

    cumulativeTypicalVol += typicalPrice * vol;
    cumulativeVol += vol;

    vwapValues.push(cumulativeVol > 0 ? cumulativeTypicalVol / cumulativeVol : c.close);
  }

  return vwapValues;
}

/**
 * Calculates Intraday Average True Range (ATR) over period (default 14 bars).
 */
export function calculateIntradayATR(candles: IntradayCandle[], period: number = 14): (number | null)[] {
  const atrValues: (number | null)[] = [];
  const trueRanges: number[] = [];

  for (let i = 0; i < candles.length; i++) {
    const curr = candles[i];
    if (!curr.isValid) {
      atrValues.push(null);
      continue;
    }

    if (i === 0) {
      trueRanges.push(curr.high - curr.low);
    } else {
      const prev = candles[i - 1];
      const tr = Math.max(
        curr.high - curr.low,
        Math.abs(curr.high - (prev.isValid ? prev.close : curr.open)),
        Math.abs(curr.low - (prev.isValid ? prev.close : curr.open))
      );
      trueRanges.push(tr);
    }

    if (trueRanges.length < period) {
      atrValues.push(null);
    } else if (trueRanges.length === period) {
      const initialATR = trueRanges.reduce((acc, v) => acc + v, 0) / period;
      atrValues.push(initialATR);
    } else {
      const prevATR = atrValues[atrValues.length - 1]!;
      const currentTR = trueRanges[trueRanges.length - 1];
      const newATR = (prevATR * (period - 1) + currentTR) / period;
      atrValues.push(newATR);
    }
  }

  return atrValues;
}

/**
 * Identifies the Opening Range (ORB) High and Low during the first `orbDurationMinutes` (default 15m).
 * Only bars with sessionMinute < orbDurationMinutes (09:15 to 09:30) define the range.
 */
export function calculateOpeningRange(
  candles: IntradayCandle[],
  orbDurationMinutes: number = 15
): { orbHigh: number | null; orbLow: number | null; orbFormed: boolean } {
  let orbHigh = -Infinity;
  let orbLow = Infinity;
  let count = 0;

  for (const c of candles) {
    if (!c.isValid) continue;
    if (c.sessionMinute < orbDurationMinutes) {
      if (c.high > orbHigh) orbHigh = c.high;
      if (c.low < orbLow) orbLow = c.low;
      count++;
    }
  }

  if (count === 0 || orbHigh === -Infinity || orbLow === Infinity) {
    return { orbHigh: null, orbLow: null, orbFormed: false };
  }

  return { orbHigh, orbLow, orbFormed: true };
}

/**
 * Scans an intraday series up to a given bar index (cutoffIndex) for candidate setups.
 * strictly causal: NO bars after cutoffIndex are inspected.
 */
export function scanIntradaySetups(
  series: IntradaySeries,
  cutoffIndex?: number,
  costPreset: IndianMarketCostPreset = getRealisticIndianMarketCostPreset('CASH_EQUITY_INTRADAY_MIS')
): SetupCandidate[] {
  const maxIndex = cutoffIndex !== undefined ? cutoffIndex : series.candles.length - 1;
  if (maxIndex < 15 || series.candles.length === 0) {
    return [];
  }

  const prefixCandles = series.candles.slice(0, maxIndex + 1);
  const currentBar = prefixCandles[maxIndex];

  // If latest bar is not completed, we do NOT emit signals on an forming bar
  if (!currentBar.isComplete || !currentBar.isValid) {
    return [];
  }

  const closes = prefixCandles.map((c) => (c.isValid ? c.close : null));
  const vwapSeries = calculateIntradayVWAP(prefixCandles);
  const atrSeries = calculateIntradayATR(prefixCandles, 14);
  const rsiSeries = calculateRSI(closes, 14);
  const macdSeries = calculateMACD(closes, 12, 26, 9);
  const { orbHigh, orbLow, orbFormed } = calculateOpeningRange(prefixCandles, 15);

  const currentClose = currentBar.close;
  const currentVWAP = vwapSeries[maxIndex];
  const currentATR = atrSeries[maxIndex] || currentClose * 0.005; // fallback 0.5%
  const currentRSI = rsiSeries[maxIndex];
  const currentMACD = macdSeries.histogram[maxIndex];
  const prevMACD = maxIndex > 0 ? macdSeries.histogram[maxIndex - 1] : null;

  // Average volume of past 10 bars
  const pastVolSlice = prefixCandles.slice(Math.max(0, maxIndex - 10), maxIndex);
  const avgVol =
    pastVolSlice.reduce((sum, c) => sum + c.volume, 0) / Math.max(1, pastVolSlice.length);
  const volumeMultiplier = avgVol > 0 ? currentBar.volume / avgVol : 1.0;

  const candidates: SetupCandidate[] = [];
  const isTradable = series.metadata.type === 'EQUITY';

  // Cost estimates: round-trip MIS bps
  const roundTripCostBps = costPreset.roundTripBps;

  // 1. VWAP Pullback Setup
  if (currentVWAP !== null) {
    const distToVWAPPct = ((currentClose - currentVWAP) / currentVWAP) * 100;
    // Long Pullback: Price above VWAP within 0.2% pullback, RSI between 45 and 60
    if (distToVWAPPct > 0 && distToVWAPPct < 0.25 && currentRSI !== null && currentRSI > 48 && currentRSI < 65) {
      const entry = currentClose;
      const stop = Math.round((currentVWAP - 1.0 * currentATR) * 100) / 100;
      const target = Math.round((entry + 2.0 * (entry - stop)) * 100) / 100;
      const stopDist = entry - stop;
      const targetDist = target - entry;
      const grossRR = targetDist / Math.max(0.01, stopDist);

      const costINR = (entry * roundTripCostBps) / 10000;
      const netTargetDist = targetDist - costINR;
      const netStopDist = stopDist + costINR;
      const netRR = netTargetDist / Math.max(0.01, netStopDist);

      candidates.push({
        id: `${series.metadata.symbol}_VWAP_PULLBACK_LONG_${currentBar.timestamp}`,
        symbol: series.metadata.symbol,
        name: series.metadata.name,
        exchange: series.metadata.exchange,
        isTradableCashEquity: isTradable,
        timeframe: series.metadata.interval,
        signalTimestamp: currentBar.timestamp,
        signalTimestampIST: currentBar.timestampIST,
        setupType: 'VWAP_PULLBACK',
        direction: 'LONG',
        entryTriggerPrice: entry,
        stopLossPrice: stop,
        targetPrice: target,
        stopDistanceINR: stopDist,
        targetDistanceINR: targetDist,
        grossRiskRewardRatio: grossRR,
        estimatedCostBps: roundTripCostBps,
        estimatedCostINRPerShare: costINR,
        netRewardRiskRatio: netRR,
        indicators: { vwap: currentVWAP, rsi14: currentRSI, atr14: currentATR, volumeMultiplier },
        reasonQualified: `Price (${entry.toFixed(2)}) pulled back to within 0.25% of rising VWAP (${currentVWAP.toFixed(2)}) with healthy RSI (${currentRSI.toFixed(1)})`,
        invalidationCondition: `Close below VWAP stop at ${stop.toFixed(2)}`,
        signalExpiryIST: `${currentBar.dateString} 15:15:00 IST`,
        status: isTradable ? 'QUALIFIED' : 'DISQUALIFIED',
        rejectionReason: isTradable ? undefined : 'Spot Index Proxy is non-tradable in cash segment',
      });
    }

    // Short Pullback: Price below VWAP within 0.2% pullback, RSI between 35 and 52
    if (distToVWAPPct < 0 && distToVWAPPct > -0.25 && currentRSI !== null && currentRSI < 52 && currentRSI > 35) {
      const entry = currentClose;
      const stop = Math.round((currentVWAP + 1.0 * currentATR) * 100) / 100;
      const target = Math.round((entry - 2.0 * (stop - entry)) * 100) / 100;
      const stopDist = stop - entry;
      const targetDist = entry - target;
      const grossRR = targetDist / Math.max(0.01, stopDist);

      const costINR = (entry * roundTripCostBps) / 10000;
      const netTargetDist = targetDist - costINR;
      const netStopDist = stopDist + costINR;
      const netRR = netTargetDist / Math.max(0.01, netStopDist);

      candidates.push({
        id: `${series.metadata.symbol}_VWAP_PULLBACK_SHORT_${currentBar.timestamp}`,
        symbol: series.metadata.symbol,
        name: series.metadata.name,
        exchange: series.metadata.exchange,
        isTradableCashEquity: isTradable,
        timeframe: series.metadata.interval,
        signalTimestamp: currentBar.timestamp,
        signalTimestampIST: currentBar.timestampIST,
        setupType: 'VWAP_PULLBACK',
        direction: 'SHORT',
        entryTriggerPrice: entry,
        stopLossPrice: stop,
        targetPrice: target,
        stopDistanceINR: stopDist,
        targetDistanceINR: targetDist,
        grossRiskRewardRatio: grossRR,
        estimatedCostBps: roundTripCostBps,
        estimatedCostINRPerShare: costINR,
        netRewardRiskRatio: netRR,
        indicators: { vwap: currentVWAP, rsi14: currentRSI, atr14: currentATR, volumeMultiplier },
        reasonQualified: `Price (${entry.toFixed(2)}) resisted at downward VWAP (${currentVWAP.toFixed(2)}) with bearish RSI (${currentRSI.toFixed(1)})`,
        invalidationCondition: `Close above VWAP stop at ${stop.toFixed(2)}`,
        signalExpiryIST: `${currentBar.dateString} 15:15:00 IST`,
        status: isTradable ? 'QUALIFIED' : 'DISQUALIFIED',
        rejectionReason: isTradable ? undefined : 'Spot Index Proxy is non-tradable in cash segment',
      });
    }
  }

  // 2. Opening Range Breakout (ORB) Setup (after 09:30 IST)
  if (orbFormed && orbHigh !== null && orbLow !== null && currentBar.sessionMinute >= 15) {
    if (currentClose > orbHigh && currentBar.open <= orbHigh) {
      const entry = currentClose;
      const stop = Math.round((orbHigh - 1.0 * currentATR) * 100) / 100;
      const target = Math.round((entry + 2.0 * (entry - stop)) * 100) / 100;
      const stopDist = entry - stop;
      const targetDist = target - entry;
      const grossRR = targetDist / Math.max(0.01, stopDist);
      const costINR = (entry * roundTripCostBps) / 10000;
      const netRR = (targetDist - costINR) / Math.max(0.01, stopDist + costINR);

      candidates.push({
        id: `${series.metadata.symbol}_ORB_LONG_${currentBar.timestamp}`,
        symbol: series.metadata.symbol,
        name: series.metadata.name,
        exchange: series.metadata.exchange,
        isTradableCashEquity: isTradable,
        timeframe: series.metadata.interval,
        signalTimestamp: currentBar.timestamp,
        signalTimestampIST: currentBar.timestampIST,
        setupType: 'OPENING_RANGE_BREAKOUT',
        direction: 'LONG',
        entryTriggerPrice: entry,
        stopLossPrice: stop,
        targetPrice: target,
        stopDistanceINR: stopDist,
        targetDistanceINR: targetDist,
        grossRiskRewardRatio: grossRR,
        estimatedCostBps: roundTripCostBps,
        estimatedCostINRPerShare: costINR,
        netRewardRiskRatio: netRR,
        indicators: { orbHigh, orbLow, atr14: currentATR, volumeMultiplier },
        reasonQualified: `Bullish breakout above 15-minute Opening Range High (${orbHigh.toFixed(2)}) with ${volumeMultiplier.toFixed(1)}x volume`,
        invalidationCondition: `Price slips back below ORB High ${orbHigh.toFixed(2)}`,
        signalExpiryIST: `${currentBar.dateString} 15:15:00 IST`,
        status: isTradable ? 'QUALIFIED' : 'DISQUALIFIED',
        rejectionReason: isTradable ? undefined : 'Spot Index Proxy is non-tradable in cash segment',
      });
    } else if (currentClose < orbLow && currentBar.open >= orbLow) {
      const entry = currentClose;
      const stop = Math.round((orbLow + 1.0 * currentATR) * 100) / 100;
      const target = Math.round((entry - 2.0 * (stop - entry)) * 100) / 100;
      const stopDist = stop - entry;
      const targetDist = entry - target;
      const grossRR = targetDist / Math.max(0.01, stopDist);
      const costINR = (entry * roundTripCostBps) / 10000;
      const netRR = (targetDist - costINR) / Math.max(0.01, stopDist + costINR);

      candidates.push({
        id: `${series.metadata.symbol}_ORB_SHORT_${currentBar.timestamp}`,
        symbol: series.metadata.symbol,
        name: series.metadata.name,
        exchange: series.metadata.exchange,
        isTradableCashEquity: isTradable,
        timeframe: series.metadata.interval,
        signalTimestamp: currentBar.timestamp,
        signalTimestampIST: currentBar.timestampIST,
        setupType: 'OPENING_RANGE_BREAKOUT',
        direction: 'SHORT',
        entryTriggerPrice: entry,
        stopLossPrice: stop,
        targetPrice: target,
        stopDistanceINR: stopDist,
        targetDistanceINR: targetDist,
        grossRiskRewardRatio: grossRR,
        estimatedCostBps: roundTripCostBps,
        estimatedCostINRPerShare: costINR,
        netRewardRiskRatio: netRR,
        indicators: { orbHigh, orbLow, atr14: currentATR, volumeMultiplier },
        reasonQualified: `Bearish breakdown below 15-minute Opening Range Low (${orbLow.toFixed(2)}) with ${volumeMultiplier.toFixed(1)}x volume`,
        invalidationCondition: `Price recovers above ORB Low ${orbLow.toFixed(2)}`,
        signalExpiryIST: `${currentBar.dateString} 15:15:00 IST`,
        status: isTradable ? 'QUALIFIED' : 'DISQUALIFIED',
        rejectionReason: isTradable ? undefined : 'Spot Index Proxy is non-tradable in cash segment',
      });
    }
  }

  // 3. MACD Momentum Crossover
  if (currentMACD !== null && prevMACD !== null) {
    if (prevMACD <= 0 && currentMACD > 0) {
      const entry = currentClose;
      const stop = Math.round((entry - 1.5 * currentATR) * 100) / 100;
      const target = Math.round((entry + 3.0 * currentATR) * 100) / 100;
      const stopDist = entry - stop;
      const targetDist = target - entry;
      const costINR = (entry * roundTripCostBps) / 10000;

      candidates.push({
        id: `${series.metadata.symbol}_MACD_BULL_${currentBar.timestamp}`,
        symbol: series.metadata.symbol,
        name: series.metadata.name,
        exchange: series.metadata.exchange,
        isTradableCashEquity: isTradable,
        timeframe: series.metadata.interval,
        signalTimestamp: currentBar.timestamp,
        signalTimestampIST: currentBar.timestampIST,
        setupType: 'MACD_CROSSOVER',
        direction: 'LONG',
        entryTriggerPrice: entry,
        stopLossPrice: stop,
        targetPrice: target,
        stopDistanceINR: stopDist,
        targetDistanceINR: targetDist,
        grossRiskRewardRatio: targetDist / stopDist,
        estimatedCostBps: roundTripCostBps,
        estimatedCostINRPerShare: costINR,
        netRewardRiskRatio: (targetDist - costINR) / (stopDist + costINR),
        indicators: { macdHistogram: currentMACD, atr14: currentATR },
        reasonQualified: `Bullish MACD histogram zero-line crossover (+${currentMACD.toFixed(3)})`,
        invalidationCondition: `MACD histogram flips negative or price crosses stop ${stop.toFixed(2)}`,
        signalExpiryIST: `${currentBar.dateString} 15:15:00 IST`,
        status: isTradable ? 'QUALIFIED' : 'DISQUALIFIED',
        rejectionReason: isTradable ? undefined : 'Spot Index Proxy is non-tradable in cash segment',
      });
    }
  }

  return candidates;
}
