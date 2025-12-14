/**
 * ZLE Payout Generator (EU + OPS PACK v1.0)
 * Generates payouts for confirmed orders based on payout rules.
 * Idempotent: will not create duplicate payouts for the same order.
 */

import { db } from './db';
import { orders, orderPayouts, payoutRules, ledgerEntries, partners } from '@shared/schema';
import { eq, and, lte, desc } from 'drizzle-orm';

const DEFAULT_CURRENCY = 'CZK';

export async function generatePayoutsForOrder(orderId: string): Promise<void> {
  try {
    const existingPayouts = await db
      .select()
      .from(orderPayouts)
      .where(eq(orderPayouts.orderId, orderId));

    if (existingPayouts.length > 0) {
      console.log(`[payouts] Order ${orderId} already has payouts, skipping`);
      return;
    }

    const order = await db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);

    if (!order[0]) {
      console.log(`[payouts] Order ${orderId} not found`);
      return;
    }

    const orderData = order[0];
    const orderTotal = orderData.total;

    const rules = await db
      .select()
      .from(payoutRules)
      .where(lte(payoutRules.validFrom, new Date()))
      .orderBy(desc(payoutRules.validFrom), payoutRules.priority);

    if (rules.length === 0) {
      console.log(`[payouts] No payout rules found, skipping payouts for order ${orderId}`);
      return;
    }

    const partnerRules: Record<string, typeof rules[0]> = {};
    for (const rule of rules) {
      if (!partnerRules[rule.partnerCode]) {
        partnerRules[rule.partnerCode] = rule;
      }
    }

    const payoutsToCreate: Array<{
      orderId: string;
      partnerCode: string;
      ruleId: string;
      amount: string;
      currency: string;
      status: string;
    }> = [];

    for (const partnerCode of Object.keys(partnerRules)) {
      const rule = partnerRules[partnerCode];
      const percent = parseFloat(rule.percent);
      const amount = (orderTotal * percent / 100).toFixed(2);
      
      payoutsToCreate.push({
        orderId,
        partnerCode,
        ruleId: rule.id,
        amount,
        currency: DEFAULT_CURRENCY,
        status: 'pending',
      });
    }

    if (payoutsToCreate.length > 0) {
      await db.insert(orderPayouts).values(payoutsToCreate);
      console.log(`[payouts] Created ${payoutsToCreate.length} payouts for order ${orderId}`);
    }

    const existingLedger = await db
      .select()
      .from(ledgerEntries)
      .where(and(
        eq(ledgerEntries.orderId, orderId),
        eq(ledgerEntries.type, 'sale')
      ));

    if (existingLedger.length === 0) {
      await db.insert(ledgerEntries).values({
        orderId,
        type: 'sale',
        direction: 'in',
        amount: orderTotal.toString(),
        currency: DEFAULT_CURRENCY,
        meta: { paymentMethod: orderData.paymentMethod },
      });
      console.log(`[payouts] Created ledger entry for order ${orderId}`);
    }

  } catch (error) {
    console.error(`[payouts] Error generating payouts for order ${orderId}:`, error);
  }
}

export async function seedPartners(): Promise<void> {
  try {
    const existingPartners = await db.select().from(partners);
    
    const requiredPartners = [
      { code: 'ZABR', displayName: 'Zabr', type: 'person' },
      { code: 'KOSTA', displayName: 'Kosta', type: 'person' },
      { code: 'TOMAS', displayName: 'Tomáš', type: 'person' },
      { code: 'GROWTH_FUND', displayName: 'Growth Fund', type: 'fund' },
    ];

    for (const partner of requiredPartners) {
      if (!existingPartners.find(p => p.code === partner.code)) {
        await db.insert(partners).values(partner);
        console.log(`[payouts] Created partner: ${partner.code}`);
      }
    }

    const existingRules = await db.select().from(payoutRules);
    
    if (existingRules.length === 0) {
      const defaultRules = [
        { partnerCode: 'ZABR', percent: '20.00', notes: 'Default 20% share' },
        { partnerCode: 'KOSTA', percent: '40.00', notes: 'Default 40% share' },
        { partnerCode: 'TOMAS', percent: '40.00', notes: 'Default 40% share' },
      ];

      for (const rule of defaultRules) {
        await db.insert(payoutRules).values(rule);
        console.log(`[payouts] Created payout rule: ${rule.partnerCode} ${rule.percent}%`);
      }
    }

    console.log('[payouts] Partner and rule seeding complete');
  } catch (error) {
    console.error('[payouts] Error seeding partners:', error);
  }
}
