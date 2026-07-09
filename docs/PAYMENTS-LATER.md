# Adding a payment gateway later (3–4 months)

The app deliberately has **no payment code**. Access is a single column:
`public.profiles.active_until` (timestamptz). The teacher extends it manually
from the Students panel today; an automated gateway just does the same thing.

## The only integration point

When a payment succeeds, run (with the service-role key, server-side):

```sql
update public.profiles
set active_until = greatest(coalesce(active_until, now()), now()) + interval '30 days' * :months
where user_id = :user_id;
```

That's it. No client changes, no new tables required (add a `payments` ledger
table at that point for records/receipts).

## Recommended providers for Pakistan

| Provider | Notes |
|---|---|
| **Safepay** | Cards + wallets, developer-friendly API + webhooks, PKR settlement. |
| **PayFast (APPS)** | Bank-backed, supports cards/wallets/bank accounts. |
| JazzCash / Easypaisa business APIs | Wallet-only, more paperwork, widest reach. |

All need a registered business/merchant account — start that paperwork ~1 month
before you want to launch payments.

## Shape of the implementation (one Supabase edge function)

1. `functions/pay-webhook`: verifies the provider's signature, maps the order to
   a `user_id`, runs the SQL above, stores the raw event in a `payments` table.
2. A "Pay now" button in the expired-access screen (`js/gate.js`,
   `renderNoAccess()`) that opens the provider's hosted checkout with the
   student's `user_id` as reference.
3. Nothing else changes — the Worker, RLS, and gate already enforce
   `active_until`.
