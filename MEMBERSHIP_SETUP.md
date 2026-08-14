# HREI Membership Setup

## Membership rules

- **Owner:** free, full access. The Supabase account using `office@hreinvestor.com` is assigned this role automatically.
- **Investor:** free, basic member access.
- **Contractor:** $25/month via Square. Contractor-only pages require an active Square subscription.

## 1. Run the database migration

In Supabase Dashboard, open **SQL Editor**, create a query, paste the complete contents of:

`supabase/migrations/20260814_hrei_member_roles.sql`

Run it once. It creates `member_profiles`, enables row-level security, creates profiles for current users, and makes `office@hreinvestor.com` the Owner.

## 2. Create the Square subscription

In Square Dashboard:

1. Create an item named **HREI Contractor Membership**.
2. Add a **$25 monthly** subscription plan.
3. Create a Square Payment Link for that subscription.
4. Replace `REPLACE_WITH_SQUARE_PAYMENT_LINK` in `payment.html` with that link.

Contractors must first create/sign in to their HREI account with the same email they use at Square. This lets the webhook attach their subscription to the correct Supabase profile.

## 3. Deploy the Square webhook

Deploy `supabase/functions/square-webhook/index.ts` as a Supabase Edge Function named `square-webhook`.

Set these Edge Function secrets:

- `SQUARE_ACCESS_TOKEN`
- `SQUARE_WEBHOOK_SIGNATURE_KEY`
- `SQUARE_WEBHOOK_NOTIFICATION_URL` = `https://<your-project-ref>.supabase.co/functions/v1/square-webhook`

In Square Developer Dashboard, create a webhook subscription for that exact URL. Enable at least:

- `subscription.created`
- `subscription.updated`
- `subscription.canceled`
- `invoice.payment_failed`

Copy Square's webhook signature key into `SQUARE_WEBHOOK_SIGNATURE_KEY`.

## 4. Test before publishing

1. Create a test Investor account; it should enter the member area without Contractor access.
2. Sign in with `office@hreinvestor.com`; it should receive Owner access.
3. Use Square Sandbox to purchase the Contractor subscription with an existing HREI account email.
4. Confirm the user's `member_profiles` row becomes `role = contractor` and `subscription_status = active`.
5. Cancel or fail a payment and confirm contractor-only access is removed.
