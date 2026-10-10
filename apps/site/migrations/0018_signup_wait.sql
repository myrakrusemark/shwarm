-- Expand only (decided Oct 10, Myra: "if someone tries to join--why not let them, but give them a message at this point
-- if they arent on the list, that they will receive an email when the site is live"). Adds one table; drops and renames
-- nothing.

-- Who joined while sign-up was invite-only from an address off the allow-list (auth/signup.ts), so they get one mail when
-- shwarm opens. An unverified account deleted after 7 days takes its row with it; verifying an address that is on the
-- allow-list by then (founding, A6) removes it, and so does closing the account.
CREATE TABLE signup_wait (
  person_id  INTEGER PRIMARY KEY REFERENCES person (id) ON DELETE CASCADE,
  joined_at  TEXT NOT NULL,
  mailed_at  TEXT                                        -- when the "shwarm is open" mail went (launch day); nothing sends it yet
);
