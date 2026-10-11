-- Expand only (go-live 10.1, donations; A13): adds one table; drops and renames nothing.

-- One row per paid Stripe object, written by the Stripe webhook (web/donate.tsx, POST /hooks/stripe): a one-time
-- payment or the first month of a monthly gift (its Checkout Session, cs_…), or a later month (its invoice, in_…).
-- Stripe resends an event until it gets a 200, so stripe_id is UNIQUE and the insert does nothing the second time.
-- What the privacy page promises we keep: the amount, the date, the note if any, and the handle only if the person
-- chose the supporters list. No email, no name, no card details; those stay at Stripe.
CREATE TABLE donation (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  stripe_id    TEXT NOT NULL UNIQUE,                   -- cs_… for once and the first month, in_… for a renewal
  kind         TEXT NOT NULL CHECK (kind IN ('once', 'monthly', 'renewal')),
  amount_cents INTEGER NOT NULL,
  currency     TEXT NOT NULL,                          -- 'usd' at launch
  note         TEXT,                                   -- up to 280 characters, one line; null when none
  handle       TEXT,                                   -- only when the donor ticked the supporters list while signed in
  public       INTEGER NOT NULL DEFAULT 0,             -- 1: the note (and handle, if any) may show on the supporters list
  created_at   TEXT NOT NULL
);
CREATE INDEX donation_created ON donation (created_at);
