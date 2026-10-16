// The create form (/new): one submit per click. The button stays off until the next page comes back.
(() => {
  const form = document.querySelector('form.new')
  if (!form) return
  form.addEventListener('submit', e => {
    if (form.dataset.sent) { e.preventDefault(); return }
    form.dataset.sent = '1'
    document.getElementById('go')?.setAttribute('aria-busy', 'true')
  })
  // ?builds_on= names a shwarm (the chip). Editing the field drops the chip.
  const up = document.getElementById('upstream'), chip = document.getElementById('picked')
  if (up && chip) up.addEventListener('input', () => {
    chip.hidden = up.value.trim() !== up.defaultValue.trim()
  })
})()
