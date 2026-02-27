# BACKLOG_SNAPSHOT

## P0
- Checkout stock deduction exactly-once guard shared by webhook + verify.  
**DoD:** Parallel finalize paths cannot deduct stock twice; one path must skip with explicit log.

## P1
- Fingerprint/idempotency mapping hardening + Stripe session reuse enforcement.  
**DoD:** New idempotency key maps to existing unpaid order and never creates second Stripe session when `stripe_checkout_session_id` exists.

## P2
- Observability + launch runbooks kept minimal and executable.  
**DoD:** Team can run preflight/smoke checks from markdown only, including race repro notes and log expectations.
