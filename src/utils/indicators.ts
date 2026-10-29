/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure Technical Indicators Calculation Engine
 * Strictly deterministic, zero external dependencies, robust handling of missing/insufficient data.
 * Adheres to rule: NEVER fabricate historical prices or silently fill missing candles.
 */

export interface IndicatorPoint {
  index: number;
  value: number | null;
}

export interface MACDResult {
  macd: (number | null)[];
  signal: (number | null)[];
  histogram: (number | null)[];
}

/**
 * Validates that an array contains valid numbers for calculation.
 */
function isValidPrice(val: unknown): val is number {
  return typeof val === 'number' && !isNaN(val) && isFinite(val) && val > 0;
}

/**
 * Simple Moving Average (SMA)
 * For any window where any price is missing (null/undefined/non-positive) or window is not full,
 * returns null. Does NOT fabricate or interpolate missing values.
 */
export function calculateSMA(prices: (number | null | undefined)[], period: number): (number | null)[] {
  if (!Array.isArray(prices) || period <= 0 || !Number.isInteger(period)) {
    return [];
  }

  const result: (number | null)[] = new Array(prices.length).fill(null);
  if (prices.length < period) {
    return result;
  }

  for (let i = period - 1; i < prices.length; i++) {
    let sum = 0;
    let hasInvalid = false;

    for (let j = i - period + 1; j <= i; j++) {
      const p = prices[j];
      if (!isValidPrice(p)) {
        hasInvalid = true;
        break;
      }
      sum += p;
    }

    if (!hasInvalid) {
      result[i] = Number((sum / period).toFixed(4));
    } else {
      result[i] = null;
    }
  }

  return result;
}

/**
 * Exponential Moving Average (EMA)
 * Multiplier k = 2 / (period + 1)
 * Initial seed: SMA of first `period` consecutive valid prices.
 * If any price is null/missing, propagates null and resets seed when next continuous window appears.
 */
export function calculateEMA(prices: (number | null | undefined)[], period: number): (number | null)[] {
  if (!Array.isArray(prices) || period <= 0 || !Number.isInteger(period)) {
    return [];
  }

  const result: (number | null)[] = new Array(prices.length).fill(null);
  if (prices.length < period) {
    return result;
  }

  const k = 2 / (period + 1);
  let prevEMA: number | null = null;
  let continuousValidCount = 0;
  let rollingSum = 0;

  for (let i = 0; i < prices.length; i++) {
    const p = prices[i];

    if (!isValidPrice(p)) {
      prevEMA = null;
      continuousValidCount = 0;
      rollingSum = 0;
      result[i] = null;
      continue;
    }

    if (prevEMA === null) {
      continuousValidCount++;
      rollingSum += p;

      if (continuousValidCount === period) {
        // Initial seed is SMA
        prevEMA = rollingSum / period;
        result[i] = Number(prevEMA.toFixed(4));
      } else {
        result[i] = null;
      }
    } else {
      // Recursive EMA
      const currentEMA: number = p * k + (prevEMA as number) * (1 - k);
      prevEMA = currentEMA;
      result[i] = Number(currentEMA.toFixed(4));
    }
  }

  return result;
}

/**
 * Relative Strength Index (RSI) - Standard Wilder's Smoothed RSI (Default period = 14)
 * Requires at least `period + 1` continuous price points.
 * Returns null if data is insufficient or interrupted by missing candles.
 * Scale: 0 to 100.
 */
export function calculateRSI(prices: (number | null | undefined)[], period: number = 14): (number | null)[] {
  if (!Array.isArray(prices) || period <= 0 || !Number.isInteger(period)) {
    return [];
  }

  const result: (number | null)[] = new Array(prices.length).fill(null);
  if (prices.length <= period) {
    return result;
  }

  // Calculate changes
  // Price changes can only be calculated when both current and previous prices are valid
  let avgGain: number | null = null;
  let avgLoss: number | null = null;
  let continuousCount = 0;
  let gains: number[] = [];
  let losses: number[] = [];

  for (let i = 1; i < prices.length; i++) {
    const current = prices[i];
    const prev = prices[i - 1];

    if (!isValidPrice(current) || !isValidPrice(prev)) {
      // Discontinuity in data: reset smoother
      avgGain = null;
      avgLoss = null;
      continuousCount = 0;
      gains = [];
      losses = [];
      result[i] = null;
      continue;
    }

    const change = current - prev;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    if (avgGain === null) {
      gains.push(gain);
      losses.push(loss);
      continuousCount++;

      if (continuousCount === period) {
        // Initial SMA of gains and losses
        avgGain = gains.reduce((a, b) => a + b, 0) / period;
        avgLoss = losses.reduce((a, b) => a + b, 0) / period;

        if (avgLoss === 0) {
          result[i] = 100;
        } else {
          const rs = avgGain / avgLoss;
          result[i] = Number((100 - 100 / (1 + rs)).toFixed(2));
        }
      } else {
        result[i] = null;
      }
    } else {
      // Wilder's smoothing: (prevAvg * (period - 1) + current) / period
      avgGain = ((avgGain as number) * (period - 1) + gain) / period;
      avgLoss = ((avgLoss as number) * (period - 1) + loss) / period;

      if (avgLoss === null || avgLoss === 0) {
        result[i] = 100;
      } else {
        const rs = avgGain / avgLoss;
        result[i] = Number((100 - 100 / (1 + rs)).toFixed(2));
      }
    }
  }

  return result;
}

/**
 * Moving Average Convergence Divergence (MACD)
 * Standard parameters: Fast = 12, Slow = 26, Signal = 9
 * MACD Line = EMA(fast) - EMA(slow)
 * Signal Line = EMA(signal) of MACD Line
 * Histogram = MACD Line - Signal Line
 */
export function calculateMACD(
  prices: (number | null | undefined)[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): MACDResult {
  const len = Array.isArray(prices) ? prices.length : 0;
  const emptyResult: MACDResult = {
    macd: new Array(len).fill(null),
    signal: new Array(len).fill(null),
    histogram: new Array(len).fill(null),
  };

  if (len < slowPeriod || fastPeriod >= slowPeriod) {
    return emptyResult;
  }

  const fastEMA = calculateEMA(prices, fastPeriod);
  const slowEMA = calculateEMA(prices, slowPeriod);

  const macdLine: (number | null)[] = new Array(len).fill(null);
  for (let i = 0; i < len; i++) {
    const f = fastEMA[i];
    const s = slowEMA[i];
    if (f !== null && s !== null) {
      macdLine[i] = Number((f - s).toFixed(4));
    } else {
      macdLine[i] = null;
    }
  }

  // Calculate EMA(signalPeriod) on valid segments of macdLine
  // Note: calculateEMA expects positive numbers if checking price, but MACD can be negative.
  // We use a generalized EMA function that allows negative values.
  const signalLine = calculateGeneralizedEMA(macdLine, signalPeriod);

  const histogram: (number | null)[] = new Array(len).fill(null);
  for (let i = 0; i < len; i++) {
    const m = macdLine[i];
    const sig = signalLine[i];
    if (m !== null && sig !== null) {
      histogram[i] = Number((m - sig).toFixed(4));
    } else {
      histogram[i] = null;
    }
  }

  return {
    macd: macdLine,
    signal: signalLine,
    histogram,
  };
}

/**
 * Generalized EMA that allows negative or zero values (used for oscillators like MACD line)
 */
export function calculateGeneralizedEMA(
  values: (number | null | undefined)[],
  period: number
): (number | null)[] {
  if (!Array.isArray(values) || period <= 0 || !Number.isInteger(period)) {
    return [];
  }

  const result: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) {
    return result;
  }

  const k = 2 / (period + 1);
  let prevEMA: number | null = null;
  let continuousCount = 0;
  let rollingSum = 0;

  for (let i = 0; i < values.length; i++) {
    const v = values[i];

    if (typeof v !== 'number' || isNaN(v) || !isFinite(v)) {
      prevEMA = null;
      continuousCount = 0;
      rollingSum = 0;
      result[i] = null;
      continue;
    }

    if (prevEMA === null) {
      continuousCount++;
      rollingSum += v;

      if (continuousCount === period) {
        prevEMA = rollingSum / period;
        result[i] = Number(prevEMA.toFixed(4));
      } else {
        result[i] = null;
      }
    } else {
      const currentEMA: number = v * k + (prevEMA as number) * (1 - k);
      prevEMA = currentEMA;
      result[i] = Number(currentEMA.toFixed(4));
    }
  }

  return result;
}
