/**
 * GDPR Anonymization (ZLE EU + OPS PACK v1.0)
 * Anonymizes user data while preserving orders for accounting.
 */

import { db } from './db';
import { users, addresses, auditLog } from '@shared/schema';
import { eq } from 'drizzle-orm';

export interface AnonymizationResult {
  success: boolean;
  userId: string;
  anonymizedFields: string[];
  addressesRemoved: number;
  ordersPreserved: boolean;
  error?: string;
}

export async function anonymizeUser(
  userId: string,
  actorUserId?: string
): Promise<AnonymizationResult> {
  try {
    const user = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user[0]) {
      return {
        success: false,
        userId,
        anonymizedFields: [],
        addressesRemoved: 0,
        ordersPreserved: true,
        error: 'User not found',
      };
    }

    const anonymizedEmail = `anonymized-${userId.slice(0, 8)}@gdpr.local`;
    const anonymizedName = 'GDPR Anonymized';

    await db
      .update(users)
      .set({
        email: anonymizedEmail,
        firstName: anonymizedName,
        lastName: '',
        profileImageUrl: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    const deletedAddresses = await db
      .delete(addresses)
      .where(eq(addresses.userId, userId))
      .returning();

    await db.insert(auditLog).values({
      actorUserId: actorUserId || null,
      action: 'gdpr_anonymize',
      entity: 'user',
      entityId: userId,
      meta: {
        anonymizedFields: ['email', 'firstName', 'lastName', 'profileImageUrl'],
        addressesRemoved: deletedAddresses.length,
        timestamp: new Date().toISOString(),
      },
    });

    console.log(`[gdpr] Anonymized user ${userId}, removed ${deletedAddresses.length} addresses`);

    return {
      success: true,
      userId,
      anonymizedFields: ['email', 'firstName', 'lastName', 'profileImageUrl'],
      addressesRemoved: deletedAddresses.length,
      ordersPreserved: true,
    };
  } catch (error) {
    console.error(`[gdpr] Error anonymizing user ${userId}:`, error);
    return {
      success: false,
      userId,
      anonymizedFields: [],
      addressesRemoved: 0,
      ordersPreserved: true,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
