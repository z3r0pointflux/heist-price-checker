const hotkeyInput = document.getElementById('hotkey') as HTMLInputElement;
const leagueSelect = document.getElementById('league') as HTMLSelectElement;
const leagueCustomInput = document.getElementById('leagueCustom') as HTMLInputElement;
const useCustomBtn = document.getElementById('useCustomBtn') as HTMLButtonElement;
const leagueStatus = document.getElementById('leagueStatus')!;
const autoDismissInput = document.getElementById('autoDismiss') as HTMLInputElement;
const dismissMsInput = document.getElementById('dismissMs') as HTMLInputElement;
const saveBtn = document.getElementById('saveBtn') as HTMLButtonElement;
const statusEl = document.getElementById('status')!;

async function loadSettings() {
  const config = await window.heistAPI.getConfig();
  hotkeyInput.value = config.hotkey;
  autoDismissInput.checked = config.autoDismiss;
  dismissMsInput.value = String(config.overlayDismissMs);

  // Try to fetch current leagues and populate dropdown
  const leagues: string[] = await window.heistAPI.getLeagues();
  if (leagues.length > 0) {
    // Clear existing options and add fetched leagues
    leagueSelect.innerHTML = '';
    for (const league of leagues) {
      const option = document.createElement('option');
      option.value = league;
      option.textContent = league;
      leagueSelect.appendChild(option);
    }
  }

  // Select current league in dropdown, or show it in custom field
  const currentLeague = config.league;
  const optionExists = Array.from(leagueSelect.options).some(o => o.value === currentLeague);
  if (optionExists) {
    leagueSelect.value = currentLeague;
  } else {
    leagueCustomInput.value = currentLeague;
    leagueStatus.textContent = `Using custom league: ${currentLeague}`;
  }
}

useCustomBtn.addEventListener('click', () => {
  const custom = leagueCustomInput.value.trim();
  if (!custom) return;

  // Add custom league to dropdown and select it
  const option = document.createElement('option');
  option.value = custom;
  option.textContent = custom;
  leagueSelect.appendChild(option);
  leagueSelect.value = custom;
  leagueCustomInput.value = '';
  leagueStatus.textContent = `Custom league "${custom}" added`;
});

saveBtn.addEventListener('click', async () => {
  const config = {
    hotkey: hotkeyInput.value.trim(),
    league: leagueSelect.value,
    autoDismiss: autoDismissInput.checked,
    overlayDismissMs: parseInt(dismissMsInput.value, 10) || 5000,
  };

  await window.heistAPI.saveConfig(config);
  statusEl.textContent = 'Saved! Prices will refresh with new league.';
  setTimeout(() => { statusEl.textContent = ''; }, 3000);
});

document.getElementById('kofi-link')!.addEventListener('click', (e) => {
  e.preventDefault();
  window.heistAPI.openExternal('https://ko-fi.com/z3r0pointflux');
});

document.getElementById('discord-link')!.addEventListener('click', (e) => {
  e.preventDefault();
  window.heistAPI.openExternal('https://discord.gg/YEfUTv58Yg');
});

loadSettings();
