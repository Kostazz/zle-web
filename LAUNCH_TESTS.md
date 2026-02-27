# LAUNCH_TESTS

## Preflight (before deploy)
- `npm run check`
- `npm run build`
- Confirm Stripe keys + webhook secret are set.
- Confirm Render service has latest commit + healthy DB connection.

## Race repro notes (manual)
1. Create one paid Stripe session for test order.
2. In two terminals run nearly together:
   - terminal A: replay Stripe webhook event (`checkout.session.completed`) for that session.
   - terminal B: call `GET /api/checkout/verify/:sessionId`.
3. PASS criteria in logs:
   - exactly one `stock_deduction_claimed order=<id>`
   - one or more `stock_deduction_skip_already_done order=<id>`
   - no second stock decrement side effects.

## Post-deploy smoke
- Render logs: no spikes of `failed_to_create_session` / `stock_deduction_failed`.
- Stripe dashboard events: each order ties to one checkout session ID.
- Curl sanity:
  - `curl -i "$BASE/api/products"`
  - `curl -i "$BASE/api/checkout/verify/<sessionId>"` (known paid session)
  - `curl -i -X POST "$BASE/api/checkout/create-session" ...` (idempotent retry).

## Recovery-mode smoke (expired/unusable checkout session)
1. In test DB pick unpaid order with `stripe_checkout_session_id` and set it to non-existing / expired session ID.
2. If `stripe_checkout_session_created_at` is recent, call `POST /api/checkout/create-session` and expect `409 SESSION_RETRY_LATER`.
3. After cooldown, call `POST /api/checkout/create-session` again.
4. PASS criteria:
   - response contains fresh `url`
   - `orders.stripe_checkout_session_id` changed to new session
   - logs include `stripe_session_recreate_unusable`.
