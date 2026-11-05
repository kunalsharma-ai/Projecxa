# Subscription payments: online and offline

Organisations pay the server owner for their PROJEXA plan. Each payment renews the subscription by itself, and
everything the plan includes comes on at once on the web and in the Android/iOS app (docs/SUPER_ADMIN.md).

- **Online:** Razorpay (UPI, cards, netbanking, wallets) and/or Stripe (cards). The keys are set up in the app, in
  **Settings → Integrations → Payments** of the organisation that runs the server. Nothing is set in the environment.
- **Offline:** bank transfer, UPI, cheque, cash or other. The organisation sees your bank details and UPI ID, pays, and
  sends the reference with an optional proof (PDF or image, up to 5 MB). The Super Admin confirms or turns it down.
- **Recorded by the Super Admin:** money received any other way (a cheque by post, a wire) is recorded in one step.

## Set it up (Super Admin)

1. **Super Admin → Plans and features**: give each plan a currency and a monthly and/or yearly price. A plan with no
   price for a period cannot be bought for it. The price label is still shown where no price is set.
2. **Super Admin → Billing → Billing settings**:
   - Online payments on or off; offline payments on or off and which methods you accept.
   - Bank details, UPI ID and any instructions shown to organisations who pay offline.
   - Tax name and percent (e.g. GST 18%), added on top of the plan price.
   - Seller name, address, tax ID, email and footer printed on invoices and receipts.
3. **Settings → Integrations → Payments** (online only):
   - **Razorpay**: Key ID and Key secret (Dashboard → Account & Settings → API keys). For the webhook, add
     `https://<api>/api/v1/public/billing/razorpay/webhook` with the events `payment.captured` and `order.paid`, and
     paste its secret. **Test** checks the keys.
   - **Stripe**: Secret key (Developers → API keys). For the webhook, add `https://<api>/api/v1/public/billing/stripe/webhook`
     with `checkout.session.completed` and `checkout.session.async_payment_succeeded`, and paste its signing secret.
   - Test keys (`rzp_test_…`, `sk_test_…`) work end to end without real money; switch to live keys when ready.

## What an organisation's admin sees

**Settings → Subscription** (admins only; also in Ctrl K):

- The current plan, status and the date it is paid until (or the trial end).
- Every plan with a price, a Monthly / Yearly switch, the tax and the total.
- **Pay online** (Razorpay Checkout opens on the page; Stripe opens its checkout page and comes back) and **Pay offline**.
- Every invoice and receipt as a PDF, with its status: Not paid, Being checked, Paid, Not found (with your reason), Cancelled.

When the subscription has ended, every page shows "Your subscription has ended". Admins get **Renew now**, which opens
Settings → Subscription; the API lets `billing/` through for admins while the subscription is inactive, and nothing
else. A paused or not yet approved organisation cannot pay until the Super Admin reactivates or approves it.

## What happens when it is paid

- The invoice becomes **Paid** and the subscription moves to the invoice's plan, **Active**, with the trial cleared.
- **Renewal from the end date:** while the subscription is still running (Active or Past due with an end date in the
  future), a month or a year is added after the current end date. Otherwise it counts from today.
- **Changing plan** takes effect at once and the time already paid for is kept (no proration, no refunds).
- The admins get a receipt by email with the PDF (sent with the server owner's email settings).
- The audit log of the organisation records `billing.paid` (Super Admin → Activity).
- The automation trigger **A payment is received** runs.

The same payment can arrive from the browser and from the webhook; it is applied once.

### How online payments are verified

- **Razorpay**: PROJEXA creates an order for the exact amount; Checkout returns the payment id and signature, and
  the server checks `HMAC-SHA256(order_id|payment_id, key secret)`. The webhook is checked with
  `X-Razorpay-Signature = HMAC-SHA256(raw body, webhook secret)` and the amount and currency must match the invoice.
- **Stripe**: PROJEXA creates a Checkout Session for the exact amount. On return, and on the webhook (checked with the
  `Stripe-Signature` header, 5 minutes tolerance), PROJEXA asks Stripe for the session and only accepts it when
  `payment_status` is `paid` and the amount and currency match.
- Card and bank details go to the gateway only; PROJEXA never sees them. A payment that reaches the gateway after its
  invoice was cancelled is still honoured.

## Offline payments (Super Admin → Billing)

- **Waiting for you to check** lists each offline payment with the method, reference, date, note and proof.
- **Payment received** confirms it and renews at once. **Not found** needs a reason, which is emailed to the admins;
  they can send it again or pay online.
- The ready-made automation **Check offline payments** emails the Super Admins and adds a task each time one arrives.
- An organisation can have at most three payments waiting at once.

**Record a payment** creates a paid invoice for any organisation and plan (the amount defaults to the plan price),
renews the subscription and emails the receipt.

## Billing page

Received this month and this year (per currency), how many payments and how many online, how many offline payments
are waiting, which gateways are set up, and every invoice filterable by status, with the PDF and the proof.

## Automation

New triggers: **A payment is received** and **An offline payment needs checking**, with `{{amount}}` and `{{detail}}`
(method and reference). Every email can use `{{payLink}}`, the organisation's Settings → Subscription link; the trial,
renewal, grace and expiry recipes now include it, so reminders lead straight to payment. New recipes: **Check offline
payments** and **Payments received**.

## API

| Method | Path | Who |
| --- | --- | --- |
| GET | `/billing` | Org admin: plan, prices, tax, gateways, offline details, invoices |
| POST | `/billing/checkout` | `{ planCode, interval: MONTHLY\|YEARLY, provider: razorpay\|stripe }` → Razorpay order or Stripe URL |
| POST | `/billing/razorpay/verify` | `{ invoiceId, orderId, paymentId, signature }` |
| POST | `/billing/stripe/confirm` | `{ invoiceId }` after returning from Stripe |
| POST | `/billing/offline` | multipart: `planCode, interval, method, reference, paidOn, note?, proof?` |
| POST | `/billing/invoices/:id/cancel` · GET `/billing/invoices/:id/pdf` | Org admin |
| GET | `/super-admin/billing` | `?status=&organizationId=` summary, waiting list, invoices |
| GET/PUT | `/super-admin/billing/settings` | Billing settings |
| POST | `/super-admin/billing/payments` | Record a payment |
| POST | `/super-admin/billing/invoices/:id/confirm` · `/reject` · `/cancel` | Review |
| GET | `/super-admin/billing/invoices/:id/proof` · `/pdf` | Files |
| POST | `/public/billing/razorpay/webhook` · `/public/billing/stripe/webhook` | Gateways (signed) |

Data: `Plan.priceMonthly`, `priceYearly`, `currency`; `Subscription.billingInterval`; `BillingInvoice` (number
`SUB-<year>-<n>` from a database sequence, amounts with tax, status, method, gateway ids, offline reference, proof,
period paid). Settings are stored with the server owner organisation (`platformSettings.billing`).

`RAZORPAY_API_URL` and `STRIPE_API_URL` can point the server at a test double; leave them unset in production.

## Not included

- Automatic recurring charges (card mandates, UPI AutoPay, Stripe subscriptions). Each period is paid when due;
  automation reminds before the end date with a pay link.
- Proration and refunds (refund in the gateway's dashboard, then adjust the subscription by hand).
- Currency conversion: an invoice is in its plan's currency, which the gateway account must accept.
