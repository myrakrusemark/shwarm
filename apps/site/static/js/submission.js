// An old submission's page (go-live 5.2). A link to one check (#c_…, as the node page's "signed log" links are) opens
// its log in place.
(() => {
  const open = () => {
    const id = location.hash.slice(1) // check ids are c_…: nothing to decode, and a mangled #% can't throw here
    const li = id && document.getElementById(id)
    const log = li && li.querySelector('details.log')
    if (log) log.open = true
  }
  open()
  addEventListener('hashchange', open)
})()

