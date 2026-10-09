// The create form (/new): one submit per click. The button stays off until the next page comes back.
(() => {
  const form = document.querySelector('form.new')
  if (!form) return
  form.addEventListener('submit', e => {
    if (form.dataset.sent) { e.preventDefault(); return }
    form.dataset.sent = '1'
    document.getElementById('go')?.setAttribute('aria-busy', 'true')
  })
  // ?builds_on= names a closed shwarm (the chip) and takes its license. Editing the field drops both, and the
  // license picker comes back.
  const up = document.getElementById('upstream'), chip = document.getElementById('picked')
  if (up && chip) up.addEventListener('input', () => {
    const same = up.value.trim() === up.defaultValue.trim()
    chip.hidden = !same
    const lic = document.getElementById('license'), note = document.getElementById('lic-up')
    if (lic) lic.hidden = same
    if (note) note.hidden = !same
  })
})()
