/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * STAGE 4E — INDIAN MARKET RISK MANAGEMENT & POSITION SIZING ENGINE
 * =================================================================
 * Enforces strict risk budgeting, capital allocation, maximum exposure caps,
 * daily drawdown limits, and SEBI MIS margin rules for intraday equities.
 *
 * Rejection decisions are completely transparent and explainable.
 */

import { calculateIndianEquityTradeCostBreakdown } from './predictionResearch.ts';

export interface RiskManagementConfig {
  accountCapitalINR: number;
  maxRiskPerTradePct: number; // e.g. 1.0% = ₹1,000 on ₹1,00,000 capital
  maxCapitalAllocationPerTradePct: number; // e.g. 40% = ₹40,000
  maxDailyLossPct: number; // e.g. 3.0% = ₹3,000 max daily loss
  maxOpenPositions: number; // e.g. 3 concurrent positions
  intradayMISMarginMultiplier: number; // SEBI peak margin rule: 5x leverage (20% margin) for large-caps
  minRiskRewardRatio: number; // e.g. 1.5 min net R:R
}

export const DEFAULT_RISK_CONFIG: RiskManagementConfig = {
  accountCapitalINR: 100000, // ₹1,00,000 standard virtual capital
  maxRiskPerTradePct: 1.0, // 1% risk per trade = ₹1,000
  maxCapitalAllocationPerTradePct: 50.0, // max 50% capital per trade
  maxDailyLossPct: 3.0, // max 3% daily loss = ₹3,000
  maxOpenPositions: 3,
  intradayMISMarginMultiplier: 5.0, // 5x leverage under SEBI MIS margin rules
  minRiskRewardRatio: 1.5,
};

export interface PositionSizingResult {
  isApproved: boolean;
  rejectionReason?: string;
  calculatedQuantity: number;
  entryPrice: number;
  stopLossPrice: number;
  targetPrice: number;
  stopDistanceINR: number;
  targetDistanceINR: number;
  positionNotionalINR: number;
  marginRequiredINR: number;
  riskBudgetINR: number;
  capitalAllocationINR: number;
  estimatedRoundTripCostINR: number;
  estimatedNetLossAtStopINR: number;
  estimatedNetProfitAtTargetINR: number;
  netRiskRewardRatio: number;
  riskPolicyDisclosures: string[];
}

/**
 * Calculates compliant position sizing for a candidate trade under Indian risk rules.
 */
export function calculateCompliantPositionSize(
  entryPrice: number,
  stopLossPrice: number,
  targetPrice: number,
  direction: 'LONG' | 'SHORT',
  currentEquityINR: number,
  availableCashINR: number,
  currentOpenPositionsCount: number,
  realizedDayPnLINR: number,
  config: RiskManagementConfig = DEFAULT_RISK_CONFIG
): PositionSizingResult {
  const disclosures: string[] = [];

  // 1. Check daily loss limit
  const maxDailyLossINR = (config.accountCapitalINR * config.maxDailyLossPct) / 100;
  if (realizedDayPnLINR <= -maxDailyLossINR) {
    return {
      isApproved: false,
      rejectionReason: `Daily loss limit of ₹${maxDailyLossINR.toLocaleString('en-IN')} (-${config.maxDailyLossPct}%) breached. Realized day P&L: ₹${realizedDayPnLINR.toLocaleString('en-IN')}. Trading paused for remainder of session.`,
      calculatedQuantity: 0,
      entryPrice,
      stopLossPrice,
      targetPrice,
      stopDistanceINR: 0,
      targetDistanceINR: 0,
      positionNotionalINR: 0,
      marginRequiredINR: 0,
      riskBudgetINR: 0,
      capitalAllocationINR: 0,
      estimatedRoundTripCostINR: 0,
      estimatedNetLossAtStopINR: 0,
      estimatedNetProfitAtTargetINR: 0,
      netRiskRewardRatio: 0,
      riskPolicyDisclosures: disclosures,
    };
  }

  // 2. Check maximum concurrent open positions
  if (currentOpenPositionsCount >= config.maxOpenPositions) {
    return {
      isApproved: false,
      rejectionReason: `Maximum concurrent open positions (${config.maxOpenPositions}) reached. Close an open position before opening new trades.`,
      calculatedQuantity: 0,
      entryPrice,
      stopLossPrice,
      targetPrice,
      stopDistanceINR: 0,
      targetDistanceINR: 0,
      positionNotionalINR: 0,
      marginRequiredINR: 0,
      riskBudgetINR: 0,
      capitalAllocationINR: 0,
      estimatedRoundTripCostINR: 0,
      estimatedNetLossAtStopINR: 0,
      estimatedNetProfitAtTargetINR: 0,
      netRiskRewardRatio: 0,
      riskPolicyDisclosures: disclosures,
    };
  }

  // 3. Validate Stop Loss geometry
  const stopDistanceINR = direction === 'LONG' ? entryPrice - stopLossPrice : stopLossPrice - entryPrice;
  const targetDistanceINR = direction === 'LONG' ? targetPrice - entryPrice : entryPrice - targetPrice;

  if (stopDistanceINR <= 0) {
    return {
      isApproved: false,
      rejectionReason: `Invalid stop-loss geometry: stop distance is <= 0 (Entry: ${entryPrice}, Stop: ${stopLossPrice}).`,
      calculatedQuantity: 0,
      entryPrice,
      stopLossPrice,
      targetPrice,
      stopDistanceINR: 0,
      targetDistanceINR: 0,
      positionNotionalINR: 0,
      marginRequiredINR: 0,
      riskBudgetINR: 0,
      capitalAllocationINR: 0,
      estimatedRoundTripCostINR: 0,
      estimatedNetLossAtStopINR: 0,
      estimatedNetProfitAtTargetINR: 0,
      netRiskRewardRatio: 0,
      riskPolicyDisclosures: disclosures,
    };
  }

  // 4. Calculate Risk Budget
  const riskBudgetINR = (currentEquityINR * config.maxRiskPerTradePct) / 100;

  // Raw quantity based strictly on stop distance
  let rawQuantity = Math.floor(riskBudgetINR / stopDistanceINR);
  if (rawQuantity < 1) {
    return {
      isApproved: false,
      rejectionReason: `Risk budget of ₹${riskBudgetINR.toFixed(2)} is insufficient to purchase even 1 share with stop distance of ₹${stopDistanceINR.toFixed(2)}.`,
      calculatedQuantity: 0,
      entryPrice,
      stopLossPrice,
      targetPrice,
      stopDistanceINR,
      targetDistanceINR,
      positionNotionalINR: 0,
      marginRequiredINR: 0,
      riskBudgetINR,
      capitalAllocationINR: 0,
      estimatedRoundTripCostINR: 0,
      estimatedNetLossAtStopINR: 0,
      estimatedNetProfitAtTargetINR: 0,
      netRiskRewardRatio: 0,
      riskPolicyDisclosures: disclosures,
    };
  }

  // 5. Apply Maximum Capital Allocation Cap
  const maxNotionalAllowed = (currentEquityINR * config.maxCapitalAllocationPerTradePct) / 100;
  const maxQtyByNotional = Math.floor(maxNotionalAllowed / entryPrice);
  if (rawQuantity > maxQtyByNotional) {
    disclosures.push(
      `Quantity capped from ${rawQuantity} to ${maxQtyByNotional} due to 50% max position capital limit (₹${maxNotionalAllowed.toFixed(0)}).`
    );
    rawQuantity = Math.max(1, maxQtyByNotional);
  }

  // 6. Apply Available Margin / Cash Constraint
  const positionNotional = rawQuantity * entryPrice;
  const marginRequired = positionNotional / config.intradayMISMarginMultiplier;

  if (marginRequired > availableCashINR) {
    const maxQtyByCash = Math.floor((availableCashINR * config.intradayMISMarginMultiplier) / entryPrice);
    if (maxQtyByCash < 1) {
      return {
        isApproved: false,
        rejectionReason: `Insufficient available cash (₹${availableCashINR.toFixed(2)}) for required MIS margin of ₹${marginRequired.toFixed(2)}.`,
        calculatedQuantity: 0,
        entryPrice,
        stopLossPrice,
        targetPrice,
        stopDistanceINR,
        targetDistanceINR,
        positionNotionalINR: 0,
        marginRequiredINR: 0,
        riskBudgetINR,
        capitalAllocationINR: 0,
        estimatedRoundTripCostINR: 0,
        estimatedNetLossAtStopINR: 0,
        estimatedNetProfitAtTargetINR: 0,
        netRiskRewardRatio: 0,
        riskPolicyDisclosures: disclosures,
      };
    }
    disclosures.push(
      `Quantity reduced from ${rawQuantity} to ${maxQtyByCash} to fit available cash margin (₹${availableCashINR.toFixed(2)}).`
    );
    rawQuantity = maxQtyByCash;
  }

  // 7. Calculate exact Indian Transaction Cost Breakdown for this exact notional
  const effectiveNotional = rawQuantity * entryPrice;
  const exitNotional = rawQuantity * targetPrice;
  const tradeCost = calculateIndianEquityTradeCostBreakdown(
    'CASH_EQUITY_INTRADAY_MIS',
    effectiveNotional,
    exitNotional
  );

  const estimatedCostINR = tradeCost.roundTripTotal.totalCostINR;
  const grossProfitINR = rawQuantity * targetDistanceINR;
  const grossLossINR = rawQuantity * stopDistanceINR;

  const netProfitAtTarget = grossProfitINR - estimatedCostINR;
  const netLossAtStop = grossLossINR + estimatedCostINR;
  const netRiskRewardRatio = netProfitAtTarget / Math.max(0.01, netLossAtStop);

  if (netRiskRewardRatio < config.minRiskRewardRatio) {
    return {
      isApproved: false,
      rejectionReason: `Net Risk-to-Reward ratio (${netRiskRewardRatio.toFixed(2)}) after statutory Indian costs (₹${estimatedCostINR.toFixed(2)}) is below the required threshold of ${config.minRiskRewardRatio}:1.`,
      calculatedQuantity: rawQuantity,
      entryPrice,
      stopLossPrice,
      targetPrice,
      stopDistanceINR,
      targetDistanceINR,
      positionNotionalINR: effectiveNotional,
      marginRequiredINR: effectiveNotional / config.intradayMISMarginMultiplier,
      riskBudgetINR,
      capitalAllocationINR: effectiveNotional,
      estimatedRoundTripCostINR: estimatedCostINR,
      estimatedNetLossAtStopINR: netLossAtStop,
      estimatedNetProfitAtTargetINR: netProfitAtTarget,
      netRiskRewardRatio,
      riskPolicyDisclosures: disclosures,
    };
  }

  disclosures.push(
    `Approved: ${rawQuantity} shares at ₹${entryPrice.toFixed(2)}. Margin: ₹${(effectiveNotional / 5).toFixed(2)}. Net R:R: ${netRiskRewardRatio.toFixed(2)}:1.`
  );

  return {
    isApproved: true,
    calculatedQuantity: rawQuantity,
    entryPrice,
    stopLossPrice,
    targetPrice,
    stopDistanceINR,
    targetDistanceINR,
    positionNotionalINR: effectiveNotional,
    marginRequiredINR: effectiveNotional / config.intradayMISMarginMultiplier,
    riskBudgetINR,
    capitalAllocationINR: effectiveNotional,
    estimatedRoundTripCostINR: estimatedCostINR,
    estimatedNetLossAtStopINR: netLossAtStop,
    estimatedNetProfitAtTargetINR: netProfitAtTarget,
    netRiskRewardRatio,
    riskPolicyDisclosures: disclosures,
  };
}
