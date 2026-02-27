# CHECKOUT_SENTINEL

## Invariants
1. **stock-only-once**: stock deduction for one order may be claimed only once via order row lock (`orders.stock_deducted_at` under `FOR UPDATE`).
2. **session-reuse + recovery**: if `orders.stripe_checkout_session_id` exists on unpaid order, checkout reuses it when usable; if the session is expired/unusable or cannot be retrieved, checkout may create a replacement session only after cooldown (`orders.stripe_checkout_session_created_at` throttle).

## Manual tests
1. **3 tabs / same basket / same fingerprint**
   - Open checkout in 3 tabs, submit quickly with different idempotency keys.
   - Expect same unpaid order reused + no duplicate Stripe session creation.
2. **Webhook + verify race**
   - Trigger `checkout.session.completed` and call `/api/checkout/verify/:sessionId` in parallel.
   - Expect one `stock_deduction_claimed`, second path logs `stock_deduction_skip_already_done`.
3. **Paid order create-session guard**
   - For paid/confirmed order call `/api/checkout/create-session`.
   - Expect `409 ORDER_ALREADY_PAID`.
4. **Expired/unusable session recovery**
   - Set unpaid order `stripe_checkout_session_id` to expired/non-existing session (or use stale expired session).
   - Call `/api/checkout/create-session`.
   - Expect `409 SESSION_RETRY_LATER` during cooldown and a new session created after cooldown.

## Expected log tags
- `stock_deduction_claimed`
- `stock_deduction_skip_already_done`
- `[checkout] order reuse hit fingerprint=`
- `SESSION_ALREADY_CREATED`
- `stripe_session_reuse_ok`
- `stripe_session_recreate_unusable`
- `stripe_session_recreate_throttled`
