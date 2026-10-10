// The admin pages' shared links (go-live 9.4). Each admin page puts this at the top of its main column.
import type { FC } from 'hono/jsx'

export const ADMIN_PAGES = [
  ['/admin', 'queue'],
  ['/admin/people', 'people'],
  ['/admin/switches', 'switches'],
  ['/admin/beta', 'beta funnel'],
  ['/moderation', 'public log'],
] as const

export const AdminNav: FC<{ here: string }> = ({ here }) => (
  <nav class="adminnav" aria-label="admin">
    {ADMIN_PAGES.map(([href, label], i) => (
      <>
        {i > 0 && ' · '}
        {href === here ? <b aria-current="page">{label}</b> : <a href={href}>{label}</a>}
      </>
    ))}
  </nav>
)
