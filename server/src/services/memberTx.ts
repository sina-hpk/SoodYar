import Decimal from "decimal.js";
import { prisma } from "../db.js";
import { issueUnits, redeemUnits, decToString } from "../lib/money.js";
import { getPortfolioState, computeMemberUnits } from "./portfolio.js";
import { audit } from "./audit.js";

/**
 * Member capital operations. Each deposit creates a DEPOSIT record (cash view)
 * plus a UNIT_ISSUANCE record (unit ledger). Withdrawals are two-phase:
 * a WITHDRAWAL_REQUEST (PENDING) then a WITHDRAWAL_SETTLEMENT (+ UNIT_REDEMPTION)
 * on settlement. Confirmed transactions are never deleted (rule #10).
 */

export interface DepositInput {
  memberId: string;
  amountRial: bigint;
  effectiveDate: Date;
  description?: string;
}

export async function createDeposit(input: DepositInput) {
  const state = await getPortfolioState();
  const navPerUnit = state.navPerUnit;
  const units = issueUnits(input.amountRial, navPerUnit);

  const result = await prisma.$transaction(async (tx) => {
    const deposit = await tx.memberTransaction.create({
      data: {
        memberId: input.memberId,
        type: "DEPOSIT",
        status: "CONFIRMED",
        amountRial: input.amountRial,
        units: "0",
        navPerUnit: decToString(navPerUnit),
        effectiveDate: input.effectiveDate,
        description: input.description,
      },
    });
    const issuance = await tx.memberTransaction.create({
      data: {
        memberId: input.memberId,
        type: "UNIT_ISSUANCE",
        status: "CONFIRMED",
        amountRial: input.amountRial,
        units: decToString(units),
        navPerUnit: decToString(navPerUnit),
        effectiveDate: input.effectiveDate,
        relatedTxId: deposit.id,
        description: input.description,
      },
    });
    // Deposit adds cash to the portfolio.
    await tx.portfolioTransaction.create({
      data: {
        type: "CASH_ADJUSTMENT",
        status: "CONFIRMED",
        cashDeltaRial: input.amountRial,
        effectiveDate: input.effectiveDate,
        description: `واریز عضو (${input.memberId})`,
      },
    });
    return { deposit, issuance };
  });

  await audit("DEPOSIT_CONFIRM", "MemberTransaction", result.deposit.id, {
    memberId: input.memberId,
    amountRial: input.amountRial,
    units: decToString(units),
    navPerUnit: decToString(navPerUnit),
  });
  return { ...result, units: decToString(units), navPerUnit: decToString(navPerUnit) };
}

export interface WithdrawalRequestInput {
  memberId: string;
  // Either redeem a specific number of units, or a target rial amount.
  units?: string;
  amountRial?: bigint;
  effectiveDate: Date;
  description?: string;
}

export async function createWithdrawalRequest(input: WithdrawalRequestInput) {
  const state = await getPortfolioState();
  const navPerUnit = state.navPerUnit;
  const unitsMap = await computeMemberUnits();
  const memberUnits = unitsMap.get(input.memberId) ?? new Decimal(0);

  let redeemUnitsCount: Decimal;
  if (input.units) {
    redeemUnitsCount = new Decimal(input.units);
  } else if (input.amountRial != null) {
    redeemUnitsCount = new Decimal(input.amountRial.toString()).div(navPerUnit);
  } else {
    throw new Error("units یا amountRial لازم است");
  }

  if (redeemUnitsCount.lte(0)) throw new Error("مقدار برداشت نامعتبر است");
  if (redeemUnitsCount.gt(memberUnits)) {
    throw new Error("واحد کافی برای برداشت وجود ندارد");
  }

  const estimatedAmount = redeemUnits(redeemUnitsCount, navPerUnit);

  const request = await prisma.memberTransaction.create({
    data: {
      memberId: input.memberId,
      type: "WITHDRAWAL_REQUEST",
      status: "PENDING",
      amountRial: estimatedAmount,
      units: decToString(redeemUnitsCount),
      navPerUnit: decToString(navPerUnit),
      effectiveDate: input.effectiveDate,
      description: input.description,
    },
  });

  await audit("WITHDRAWAL_REQUEST", "MemberTransaction", request.id, {
    memberId: input.memberId,
    units: decToString(redeemUnitsCount),
    estimatedAmountRial: estimatedAmount,
    navPerUnit: decToString(navPerUnit),
  });
  return request;
}

/**
 * Settles a pending withdrawal request. NAV is re-evaluated at settlement time,
 * so the final amount can differ from the estimate. Creates a UNIT_REDEMPTION
 * and a WITHDRAWAL_SETTLEMENT, and removes cash from the portfolio.
 */
export async function settleWithdrawal(requestId: string, settleDate: Date) {
  const request = await prisma.memberTransaction.findUnique({
    where: { id: requestId },
  });
  if (!request) throw new Error("درخواست برداشت یافت نشد");
  if (request.type !== "WITHDRAWAL_REQUEST")
    throw new Error("تراکنش از نوع درخواست برداشت نیست");
  if (request.status !== "PENDING")
    throw new Error("این درخواست قبلاً پردازش شده است");

  const state = await getPortfolioState();
  const navPerUnit = state.navPerUnit;
  const redeemedUnits = new Decimal(request.units);
  const finalAmount = redeemUnits(redeemedUnits, navPerUnit);

  const result = await prisma.$transaction(async (tx) => {
    const redemption = await tx.memberTransaction.create({
      data: {
        memberId: request.memberId,
        type: "UNIT_REDEMPTION",
        status: "CONFIRMED",
        amountRial: finalAmount,
        units: decToString(redeemedUnits),
        navPerUnit: decToString(navPerUnit),
        effectiveDate: settleDate,
        relatedTxId: request.id,
      },
    });
    const settlement = await tx.memberTransaction.create({
      data: {
        memberId: request.memberId,
        type: "WITHDRAWAL_SETTLEMENT",
        status: "SETTLED",
        amountRial: finalAmount,
        units: "0",
        navPerUnit: decToString(navPerUnit),
        effectiveDate: settleDate,
        relatedTxId: request.id,
      },
    });
    // Mark the original request as SETTLED (status change, not deletion — rule #10).
    await tx.memberTransaction.update({
      where: { id: request.id },
      data: { status: "SETTLED", relatedTxId: settlement.id },
    });
    // Remove cash from the portfolio.
    await tx.portfolioTransaction.create({
      data: {
        type: "CASH_ADJUSTMENT",
        status: "CONFIRMED",
        cashDeltaRial: -finalAmount,
        effectiveDate: settleDate,
        description: `تسویه برداشت عضو (${request.memberId})`,
      },
    });
    return { redemption, settlement };
  });

  await audit("WITHDRAWAL_SETTLE", "MemberTransaction", result.settlement.id, {
    requestId,
    memberId: request.memberId,
    units: decToString(redeemedUnits),
    finalAmountRial: finalAmount,
    navPerUnit: decToString(navPerUnit),
  });
  return { ...result, finalAmountRial: finalAmount.toString() };
}

/** Cancels a still-pending withdrawal request (rule #10: status change only). */
export async function cancelWithdrawalRequest(requestId: string) {
  const request = await prisma.memberTransaction.findUnique({
    where: { id: requestId },
  });
  if (!request) throw new Error("درخواست یافت نشد");
  if (request.status !== "PENDING")
    throw new Error("فقط درخواست‌های در انتظار قابل لغو هستند");
  const updated = await prisma.memberTransaction.update({
    where: { id: requestId },
    data: { status: "CANCELLED" },
  });
  await audit("WITHDRAWAL_CANCEL", "MemberTransaction", requestId, {
    memberId: request.memberId,
  });
  return updated;
}
