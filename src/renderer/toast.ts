const toastEl = document.getElementById('toast')!;
const toastHintEl = document.getElementById('hint')!;
const toastHotkeyEl = document.getElementById('hotkey')!;
const toastHintTextEl = document.getElementById('hint-text')!;
const toastStatusTextEl = document.getElementById('status-text')!;

// The tone drives the spine colour and the status dot together, so it is applied
// to the panel and cleared as a group rather than toggled one class at a time.
const TOAST_TONES = ['pending', 'ok', 'warn', 'error'];

let toastMeasured = false;

window.heistAPI.onToastUpdate((data: any) => {
  if (data.hotkey) {
    toastHotkeyEl.textContent = data.hotkey;
  }

  // A hotkey that failed to register is the failure that looks like the app not
  // running at all — say so here rather than leaving it in the log.
  if (data.hotkeyOk === false) {
    toastHintTextEl.textContent = 'is already taken — pick another in Settings';
    toastHintEl.classList.add('error');
  } else {
    toastHintTextEl.textContent = 'over an item to price it';
    toastHintEl.classList.remove('error');
  }

  if (data.status) {
    toastStatusTextEl.textContent = data.status.text;
    for (const tone of TOAST_TONES) toastEl.classList.remove(tone);
    toastEl.classList.add(data.status.tone);
  }

  // The window is created at a guessed size and anchored to the bottom-right
  // corner, so an oversized one leaves the panel floating away from the corner.
  // Report the panel's real size once laid out and let main trim the window to
  // it; main shows the window only after that, so there is no jump to see.
  requestAnimationFrame(() => {
    const rect = toastEl.getBoundingClientRect();
    const pad = parseFloat(getComputedStyle(document.body).paddingLeft) || 0;
    window.heistAPI.reportToastSize(
      Math.ceil(rect.width + pad * 2),
      Math.ceil(rect.height + pad * 2),
    );
    toastMeasured = true;
    toastEl.classList.add('shown');
  });
});

window.heistAPI.onToastDismiss(() => {
  // Fade out here; main hides the window once the transition has had time to run.
  toastEl.classList.remove('shown');
  if (toastMeasured) toastEl.classList.add('leaving');
});
