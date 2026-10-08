// What the mail code needs from the Worker env. Secrets are set with `wrangler secret put` per env.
export type MailEnv = {
  DB: D1Database
  ENV: string // 'production' sends to anyone; every other env sends only to signup_allow addresses
  SITE_URL: string // https://shwarm.org, or the staging URL; every link in a mail starts with it
  RESEND_API_KEY?: string // secret; without it the sweep sends nothing
  MAIL_SECRET?: string // secret; signs unsubscribe links
  RESEND_WEBHOOK_SECRET?: string // secret; basic-auth password on POST /hooks/resend
}

export const FROM = 'shwarm <hello@mail.shwarm.org>'
export const REPLY_TO = 'support@shwarm.org'
