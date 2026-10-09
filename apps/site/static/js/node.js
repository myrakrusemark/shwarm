// Node pages: the contribute card's copy button (as in mockups/shwarm.html).
(() => {
  const copy = document.getElementById('w-copy')
  const url = document.getElementById('w-url')
  if (!copy || !url) return
  copy.addEventListener('click', () => {
    navigator.clipboard?.writeText(url.textContent).then(() => {
      copy.textContent = 'copied'
      setTimeout(() => { copy.textContent = 'copy' }, 1200)
    })
  })
})()
