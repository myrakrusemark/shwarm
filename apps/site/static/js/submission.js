// The submission page (go-live 5.2, 5.3, 5.5). A link to one check (#c_…, as the node page's "signed log" links are)
// opens its log in place, and each form sends once per click: the button stays off until the page comes back.
(() => {
  const open = () => {
    const id = decodeURIComponent(location.hash.slice(1))
    const li = id && document.getElementById(id)
    const log = li && li.querySelector('details.log')
    if (log) log.open = true
  }
  open()
  addEventListener('hashchange', open)
})()

document.querySelectorAll('main form[method="post"]').forEach(form => {
  form.addEventListener('submit', e => {
    if (form.dataset.sent) { e.preventDefault(); return }
    form.dataset.sent = '1'
    const b = form.querySelector('button[type="submit"]')
    if (b) b.setAttribute('aria-busy', 'true')
  })
})
