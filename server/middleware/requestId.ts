/**
 * ZLE Request ID Middleware (ZLE v1.2.2)
 * Generates x-request-id if missing for observability.
 */

import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

/**
 * Middleware that ensures every request has a unique ID.
 * - Uses existing x-request-id header if present
 * - Generates a new UUID if not present
 * - Adds the ID to response headers
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const existingId = req.headers['x-request-id'];
  const requestId = typeof existingId === 'string' ? existingId : randomUUID();
  
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  
  next();
}

/**
 * Get request ID from request object.
 */
export function getRequestId(req: Request): string {
  return req.requestId || 'unknown';
}
