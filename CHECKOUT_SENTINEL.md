# CHECKOUT_SENTINEL

## Invariants
1. **stock-only-once**: stock deduction for one order may be claimed only once via order row lock (`orders.stock_deducted_at` under `FOR UPDATE`).
2. **session-reuse**: if `orders.stripe_checkout_session_id` exists on unpaid order, checkout must reuse it (or return `SESSION_ALREADY_CREATED`) and never create a second Stripe session.

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

## Expected log tags
- `stock_deduction_claimed`
- `stock_deduction_skip_already_done`
- `[checkout] order reuse hit fingerprint=`
- `SESSION_ALREADY_CREATED`
