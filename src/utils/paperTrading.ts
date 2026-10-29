/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * STAGE 4F — REALISTIC PAPER TRADING, HISTORICAL REPLAY & ALERTS ENGINE
 * ====================================================================
 * Virtual trading ledger for Indian equities supporting:
 * - Longs & Shorts (MIS intraday)
 * - Market, Limit, Stop-Loss, and Target orders
 * - Realistic fill execution with conservative collision handling (worst-case stop-first)
 * - Complete Stage 4C side-specific Indian cost accounting (brokerage, STT, GST, etc.)
 * - Step-by-step historical replay ("Time Machine")
 * - Deduplicated in-app alerts and notifications
 * - NEVER places real brokerage trades or connects to live broker execution APIs.
 */

import { IntradayCandle } from '../services/intradayData.ts';
import { calculateIndianEquityTradeCostBreakdown } from './predictionResearch.ts';
import { SetupCandidate } from './intradayScanner.ts';
import { PositionSizingResult } from './riskManagement.ts';

export type OrderType = 'MARKET' | 'LIMIT' | 'STOP_LOSS' | 'TAKE_PROFIT';
export type OrderSide = 'BUY' | 'SELL';
export type OrderStatus = 'PENDING' | 'FILLED' | 'CANCELLED' | 'REJECTED';

export interface PaperOrder {
  id: string;
  symbol: string;
  name: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  requestedPrice: number;
  stopPrice?: number;
  limitPrice?: number;
  status: OrderStatus;
  fillPrice?: number;
  fillTimestamp?: number;
  fillTimestampIST?: string;
  feesINR?: number;
  rejectionReason?: string;
  createdAt: number;
  createdAtIST: string;
}

export interface PaperPosition {
  symbol: string;
  name: string;
  direction: 'LONG' | 'SHORT';
  quantity: number;
  averageEntryPrice: number;
  currentPrice: number;
  stopLossPrice: number;
  targetPrice: number;
  marginBlockedINR: number;
  unrealizedPnLINR: number;
  unrealizedPnLPct: number;
  entryTimestamp: number;
  entryTimestampIST: string;
}

export interface PaperTradeJournalEntry {
  id: string;
  symbol: string;
  name: string;
  direction: 'LONG' | 'SHORT';
  quantity: number;
  entryPrice: number;
  exitPrice: number;
  entryTimestamp: number;
  entryTimestampIST: string;
  exitTimestamp: number;
  exitTimestampIST: string;
  exitReason: 'TARGET' | 'STOP_LOSS' | 'AUTO_SQUARE_OFF' | 'MANUAL_EXIT';
  grossPnLINR: number;
  totalFeesINR: number;
  netPnLINR: number;
  returnPct: number;
  feesBreakdown: {
    brokerage: number;
    stt: number;
    exchangeCharges: number;
    sebiCharges: number;
    gst: number;
    stampDuty: number;
  };
}

export interface PaperAccountState {
  initialCapitalINR: number;
  availableCashINR: number;
  equityINR: number;
  marginBlockedINR: number;
  realizedPnLINR: number;
  unrealizedPnLINR: number;
  totalFeesPaidINR: number;
  peakEquityINR: number;
  maxDrawdownINR: number;
  maxDrawdownPct: number;
  winCount: number;
  lossCount: number;
  totalTrades: number;
  openPositions: PaperPosition[];
  orderHistory: PaperOrder[];
  tradeJournal: PaperTradeJournalEntry[];
}

export interface ReplayState {
  isRunning: boolean;
  isPaused: boolean;
  currentIndex: number;
  totalBars: number;
  currentBar: IntradayCandle | null;
  speedMs: number;
}

export interface PaperAlert {
  id: string;
  timestamp: number;
  timestampIST: string;
  type: 'SIGNAL_ALERT' | 'ORDER_FILLED' | 'TARGET_HIT' | 'STOP_HIT' | 'SQUARE_OFF' | 'RISK_BREACH';
  title: string;
  message: string;
  severity: 'INFO' | 'SUCCESS' | 'WARNING' | 'DANGER';
  read: boolean;
}

export class PaperTradingEngine {
  private state: PaperAccountState;
  private alerts: PaperAlert[] = [];
  private seenAlertKeys = new Set<string>();

  constructor(initialCapitalINR: number = 100000) {
    this.state = {
      initialCapitalINR,
      availableCashINR: initialCapitalINR,
      equityINR: initialCapitalINR,
      marginBlockedINR: 0,
      realizedPnLINR: 0,
      unrealizedPnLINR: 0,
      totalFeesPaidINR: 0,
      peakEquityINR: initialCapitalINR,
      maxDrawdownINR: 0,
      maxDrawdownPct: 0,
      winCount: 0,
      lossCount: 0,
      totalTrades: 0,
      openPositions: [],
      orderHistory: [],
      tradeJournal: [],
    };
  }

  public getState(): PaperAccountState {
    return { ...this.state, openPositions: [...this.state.openPositions] };
  }

  public getAlerts(): PaperAlert[] {
    return [...this.alerts];
  }

  public reset(initialCapitalINR: number = 100000) {
    this.state = {
      initialCapitalINR,
      availableCashINR: initialCapitalINR,
      equityINR: initialCapitalINR,
      marginBlockedINR: 0,
      realizedPnLINR: 0,
      unrealizedPnLINR: 0,
      totalFeesPaidINR: 0,
      peakEquityINR: initialCapitalINR,
      maxDrawdownINR: 0,
      maxDrawdownPct: 0,
      winCount: 0,
      lossCount: 0,
      totalTrades: 0,
      openPositions: [],
      orderHistory: [],
      tradeJournal: [],
    };
    this.alerts = [];
    this.seenAlertKeys.clear();
  }

  /**
   * Adds an alert with deduplication.
   */
  public addAlert(
    key: string,
    type: PaperAlert['type'],
    title: string,
    message: string,
    severity: PaperAlert['severity'],
    timestamp: number = Date.now(),
    timestampIST: string = new Date().toLocaleTimeString('en-IN')
  ) {
    if (this.seenAlertKeys.has(key)) return;
    this.seenAlertKeys.add(key);

    const alert: PaperAlert = {
      id: key,
      timestamp,
      timestampIST,
      type,
      title,
      message,
      severity,
      read: false,
    };
    this.alerts.unshift(alert);
    if (this.alerts.length > 50) this.alerts.pop();
  }

  /**
   * Submits a new paper order based on an approved candidate and position sizing result.
   */
  public executeCandidateOrder(
    candidate: SetupCandidate,
    sizing: PositionSizingResult,
    currentBar: IntradayCandle
  ): { success: boolean; order?: PaperOrder; reason?: string } {
    if (!sizing.isApproved || sizing.calculatedQuantity <= 0) {
      return { success: false, reason: sizing.rejectionReason || 'Trade sizing not approved' };
    }

    const marginRequired = sizing.marginRequiredINR;
    if (marginRequired > this.state.availableCashINR) {
      return {
        success: false,
        reason: `Insufficient cash margin. Required: ₹${marginRequired.toFixed(2)}, Available: ₹${this.state.availableCashINR.toFixed(2)}`,
      };
    }

    const orderSide: OrderSide = candidate.direction === 'LONG' ? 'BUY' : 'SELL';
    const notional = sizing.calculatedQuantity * candidate.entryTriggerPrice;

    // Estimate BUY fee
    const costBreakdown = calculateIndianEquityTradeCostBreakdown(
      'CASH_EQUITY_INTRADAY_MIS',
      notional,
      notional
    );
    const entryFee = costBreakdown.entryBuyOrder.totalCostINR;

    // Deduct margin and fee
    this.state.availableCashINR -= marginRequired + entryFee;
    this.state.marginBlockedINR += marginRequired;
    this.state.totalFeesPaidINR += entryFee;

    const orderId = `ORD_${candidate.symbol}_${currentBar.timestamp}_${Math.floor(Math.random() * 1000)}`;
    const paperOrder: PaperOrder = {
      id: orderId,
      symbol: candidate.symbol,
      name: candidate.name,
      side: orderSide,
      type: 'MARKET',
      quantity: sizing.calculatedQuantity,
      requestedPrice: candidate.entryTriggerPrice,
      stopPrice: candidate.stopLossPrice,
      limitPrice: candidate.targetPrice,
      status: 'FILLED',
      fillPrice: candidate.entryTriggerPrice,
      fillTimestamp: currentBar.timestamp,
      fillTimestampIST: currentBar.timestampIST,
      feesINR: entryFee,
      createdAt: currentBar.timestamp,
      createdAtIST: currentBar.timestampIST,
    };

    this.state.orderHistory.unshift(paperOrder);

    // Create open position
    const position: PaperPosition = {
      symbol: candidate.symbol,
      name: candidate.name,
      direction: candidate.direction,
      quantity: sizing.calculatedQuantity,
      averageEntryPrice: candidate.entryTriggerPrice,
      currentPrice: candidate.entryTriggerPrice,
      stopLossPrice: candidate.stopLossPrice,
      targetPrice: candidate.targetPrice,
      marginBlockedINR: marginRequired,
      unrealizedPnLINR: 0,
      unrealizedPnLPct: 0,
      entryTimestamp: currentBar.timestamp,
      entryTimestampIST: currentBar.timestampIST,
    };

    this.state.openPositions.push(position);
    this.updateEquity();

    this.addAlert(
      `FILL_${orderId}`,
      'ORDER_FILLED',
      `Order Filled: ${orderSide} ${candidate.symbol}`,
      `Filled ${sizing.calculatedQuantity} shares at ₹${candidate.entryTriggerPrice.toFixed(2)}. Target: ₹${candidate.targetPrice.toFixed(2)}, Stop: ₹${candidate.stopLossPrice.toFixed(2)}.`,
      'SUCCESS',
      currentBar.timestamp,
      currentBar.timestampIST
    );

    return { success: true, order: paperOrder };
  }

  /**
   * Evaluates open positions against an incoming bar (OHLC) in chronological sequence.
   * Handles target hit, stop loss hit, and end-of-session auto square-off.
   * Conservative collision resolution: if high touches target AND low touches stop within the same candle,
   * STOP-LOSS is executed first.
   */
  public evaluatePositionsOnBar(candle: IntradayCandle, symbol?: string) {
    const remainingPositions: PaperPosition[] = [];
    const candleSymbol = (candle as any).symbol || symbol;

    for (const pos of this.state.openPositions) {
      if (!candle.isValid || (candleSymbol && pos.symbol !== candleSymbol)) {
        remainingPositions.push(pos);
        continue;
      }

      // Update current mark-to-market price
      pos.currentPrice = candle.close;
      const priceDiff =
        pos.direction === 'LONG'
          ? candle.close - pos.averageEntryPrice
          : pos.averageEntryPrice - candle.close;
      pos.unrealizedPnLINR = priceDiff * pos.quantity;
      pos.unrealizedPnLPct = (pos.unrealizedPnLINR / (pos.averageEntryPrice * pos.quantity)) * 100;

      let shouldClose = false;
      let exitPrice = candle.close;
      let exitReason: PaperTradeJournalEntry['exitReason'] = 'MANUAL_EXIT';

      // Check collision / stop / target
      if (pos.direction === 'LONG') {
        const stopHit = candle.low <= pos.stopLossPrice;
        const targetHit = candle.high >= pos.targetPrice;

        if (stopHit && targetHit) {
          // Conservative rule: stop-loss hit first
          shouldClose = true;
          exitPrice = pos.stopLossPrice;
          exitReason = 'STOP_LOSS';
        } else if (stopHit) {
          shouldClose = true;
          exitPrice = pos.stopLossPrice;
          exitReason = 'STOP_LOSS';
        } else if (targetHit) {
          shouldClose = true;
          exitPrice = pos.targetPrice;
          exitReason = 'TARGET';
        }
      } else {
        // SHORT position
        const stopHit = candle.high >= pos.stopLossPrice;
        const targetHit = candle.low <= pos.targetPrice;

        if (stopHit && targetHit) {
          shouldClose = true;
          exitPrice = pos.stopLossPrice;
          exitReason = 'STOP_LOSS';
        } else if (stopHit) {
          shouldClose = true;
          exitPrice = pos.stopLossPrice;
          exitReason = 'STOP_LOSS';
        } else if (targetHit) {
          shouldClose = true;
          exitPrice = pos.targetPrice;
          exitReason = 'TARGET';
        }
      }

      // Check Intraday MIS session square-off (at or after 15:15 IST)
      if (!shouldClose && candle.sessionMinute >= 360) {
        // 360 mins from 09:15 = 15:15 IST
        shouldClose = true;
        exitPrice = candle.close;
        exitReason = 'AUTO_SQUARE_OFF';
      }

      if (shouldClose) {
        this.closePosition(pos, exitPrice, exitReason, candle.timestamp, candle.timestampIST);
      } else {
        remainingPositions.push(pos);
      }
    }

    this.state.openPositions = remainingPositions;
    this.updateEquity();
  }

  /**
   * Closes a position, releases margin, deducts statutory exit fees, and updates journal.
   */
  private closePosition(
    pos: PaperPosition,
    exitPrice: number,
    exitReason: PaperTradeJournalEntry['exitReason'],
    timestamp: number,
    timestampIST: string
  ) {
    const entryNotional = pos.quantity * pos.averageEntryPrice;
    const exitNotional = pos.quantity * exitPrice;

    const costBreakdown = calculateIndianEquityTradeCostBreakdown(
      'CASH_EQUITY_INTRADAY_MIS',
      entryNotional,
      exitNotional
    );
    const exitFee = costBreakdown.exitSellOrder.totalCostINR;
    const totalFees = costBreakdown.roundTripTotal.totalCostINR;

    const grossPnL =
      pos.direction === 'LONG'
        ? (exitPrice - pos.averageEntryPrice) * pos.quantity
        : (pos.averageEntryPrice - exitPrice) * pos.quantity;

    const netPnL = grossPnL - totalFees;
    const returnPct = (netPnL / entryNotional) * 100;

    // Release margin and add net proceeds
    this.state.marginBlockedINR = Math.max(0, this.state.marginBlockedINR - pos.marginBlockedINR);
    this.state.availableCashINR += pos.marginBlockedINR + grossPnL - exitFee;
    this.state.realizedPnLINR += netPnL;
    this.state.totalTrades++;

    if (netPnL > 0) this.state.winCount++;
    else this.state.lossCount++;

    const tradeId = `TRD_${pos.symbol}_${timestamp}_${Math.floor(Math.random() * 1000)}`;
    const journalEntry: PaperTradeJournalEntry = {
      id: tradeId,
      symbol: pos.symbol,
      name: pos.name,
      direction: pos.direction,
      quantity: pos.quantity,
      entryPrice: pos.averageEntryPrice,
      exitPrice,
      entryTimestamp: pos.entryTimestamp,
      entryTimestampIST: pos.entryTimestampIST,
      exitTimestamp: timestamp,
      exitTimestampIST: timestampIST,
      exitReason,
      grossPnLINR: grossPnL,
      totalFeesINR: totalFees,
      netPnLINR: netPnL,
      returnPct,
      feesBreakdown: {
        brokerage: costBreakdown.roundTripTotal.brokerageINR,
        stt: costBreakdown.roundTripTotal.sttINR,
        exchangeCharges: costBreakdown.roundTripTotal.exchangeTransactionChargesINR,
        sebiCharges: costBreakdown.roundTripTotal.sebiChargesINR,
        gst: costBreakdown.roundTripTotal.gstINR,
        stampDuty: costBreakdown.roundTripTotal.stampDutyINR,
      },
    };

    this.state.tradeJournal.unshift(journalEntry);

    const alertType =
      exitReason === 'TARGET'
        ? 'TARGET_HIT'
        : exitReason === 'STOP_LOSS'
        ? 'STOP_HIT'
        : 'SQUARE_OFF';

    const severity = netPnL >= 0 ? 'SUCCESS' : 'DANGER';

    this.addAlert(
      `CLOSE_${tradeId}`,
      alertType,
      `Position Closed: ${pos.symbol} (${exitReason})`,
      `${pos.direction} ${pos.quantity} shares exited at ₹${exitPrice.toFixed(2)}. Net P&L: ₹${netPnL >= 0 ? '+' : ''}${netPnL.toFixed(2)} (${returnPct.toFixed(2)}%). Fees: ₹${totalFees.toFixed(2)}.`,
      severity,
      timestamp,
      timestampIST
    );
  }

  /**
   * Recalculates total account equity, unrealized P&L, and drawdown.
   */
  private updateEquity() {
    let totalUnrealized = 0;
    for (const pos of this.state.openPositions) {
      totalUnrealized += pos.unrealizedPnLINR;
    }

    this.state.unrealizedPnLINR = totalUnrealized;
    this.state.equityINR = this.state.availableCashINR + this.state.marginBlockedINR + totalUnrealized;

    if (this.state.equityINR > this.state.peakEquityINR) {
      this.state.peakEquityINR = this.state.equityINR;
    }

    const drawdownINR = Math.max(0, this.state.peakEquityINR - this.state.equityINR);
    const drawdownPct = this.state.peakEquityINR > 0 ? (drawdownINR / this.state.peakEquityINR) * 100 : 0;

    this.state.maxDrawdownINR = Math.max(this.state.maxDrawdownINR, drawdownINR);
    this.state.maxDrawdownPct = Math.max(this.state.maxDrawdownPct, drawdownPct);
  }
}
