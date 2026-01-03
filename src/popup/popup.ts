import { getSettings, saveSettings, addCustomRule, removeCustomRule } from '../lib/storage';
import type { UserSettings } from '../types';

const COUNTRIES = [
  { name: 'United States', flag: '🇺🇸', value: 'United States' },
  { name: 'India', flag: '🇮🇳', value: 'India' },
  { name: 'Brazil', flag: '🇧🇷', value: 'Brazil' },
  { name: 'Europe', flag: '🇪🇺', value: 'Europe' },
  { name: 'Japan', flag: '🇯🇵', value: 'Japan' },
  { name: 'United Kingdom', flag: '🇬🇧', value: 'United Kingdom' },
  { name: 'Turkey', flag: '🇹🇷', value: 'Turkey' },
  { name: 'Indonesia', flag: '🇮🇩', value: 'Indonesia' },
  { name: 'Mexico', flag: '🇲🇽', value: 'Mexico' },
  { name: 'Saudi Arabia', flag: '🇸🇦', value: 'Saudi Arabia' },
];

let currentSettings: UserSettings;

async function init() {
  currentSettings = await getSettings();
  renderUI();
  bindEvents();
}

function renderUI() {
  const enableToggle = document.getElementById('enableToggle') as HTMLInputElement;
  const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;

  enableToggle.checked = currentSettings.enabled;
  apiKeyInput.value = currentSettings.apiKey;

  renderCountryPicker();
  renderChips();
}

function getActiveCountries(): Set<string> {
  const countryRules = currentSettings.customRules.filter(r => r.type === 'country' && r.enabled);
  return new Set(countryRules.map(r => r.value));
}

function renderCountryPicker() {
  const container = document.getElementById('countryPicker')!;
  container.innerHTML = '';

  const activeCountries = getActiveCountries();

  COUNTRIES.forEach(country => {
    const btn = document.createElement('button');
    btn.className = 'country-btn';
    btn.dataset.country = country.value;
    
    if (activeCountries.has(country.value)) {
      btn.classList.add('active');
    }
    
    btn.innerHTML = `<span class="flag">${country.flag}</span>${country.name}`;
    container.appendChild(btn);
  });
}

function renderChips() {
  const container = document.getElementById('customRules')!;
  container.innerHTML = '';

  const contentRules = currentSettings.customRules.filter(r => r.type === 'content');

  if (contentRules.length === 0) {
    container.innerHTML = '<div class="empty-state">No filters yet</div>';
    return;
  }

  contentRules.forEach(rule => {
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.innerHTML = `
      <span class="chip-text">${escapeHtml(rule.value)}</span>
      <button class="chip-remove" data-id="${rule.id}" title="Remove">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 6 6 18"/>
          <path d="m6 6 12 12"/>
        </svg>
      </button>
    `;
    container.appendChild(chip);
  });
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function updateAddButton() {
  const input = document.getElementById('ruleValue') as HTMLInputElement;
  const button = document.getElementById('addRule') as HTMLButtonElement;
  const plusIcon = document.getElementById('plusIcon')!;
  const checkIcon = document.getElementById('checkIcon')!;

  const hasValue = input.value.trim().length > 0;

  button.disabled = !hasValue;

  if (hasValue) {
    plusIcon.classList.add('hidden');
    checkIcon.classList.remove('hidden');
  } else {
    plusIcon.classList.remove('hidden');
    checkIcon.classList.add('hidden');
  }
}

function notifySettingsUpdate() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'SETTINGS_UPDATED' });
    }
  });
}

async function save() {
  const enableToggle = document.getElementById('enableToggle') as HTMLInputElement;
  const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;

  await saveSettings({
    enabled: enableToggle.checked,
    apiKey: apiKeyInput.value
  });

  notifySettingsUpdate();
}

async function toggleCountry(countryValue: string) {
  const existingRule = currentSettings.customRules.find(
    r => r.type === 'country' && r.value === countryValue
  );

  if (existingRule) {
    await removeCustomRule(existingRule.id);
  } else {
    await addCustomRule({ type: 'country', value: countryValue });
  }

  currentSettings = await getSettings();
  renderCountryPicker();
  notifySettingsUpdate();
}

function bindEvents() {
  document.getElementById('toggleApiKey')?.addEventListener('click', () => {
    const input = document.getElementById('apiKey') as HTMLInputElement;
    const eyeIcon = document.getElementById('eyeIcon')!;
    const eyeOffIcon = document.getElementById('eyeOffIcon')!;
    
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    
    eyeIcon.classList.toggle('hidden', isPassword);
    eyeOffIcon.classList.toggle('hidden', !isPassword);
  });

  document.getElementById('enableToggle')?.addEventListener('change', save);

  let apiKeyTimeout: ReturnType<typeof setTimeout>;
  document.getElementById('apiKey')?.addEventListener('input', () => {
    clearTimeout(apiKeyTimeout);
    apiKeyTimeout = setTimeout(save, 800);
  });

  document.getElementById('countryPicker')?.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest('.country-btn') as HTMLElement;
    if (btn) {
      await toggleCountry(btn.dataset.country!);
    }
  });

  document.getElementById('ruleValue')?.addEventListener('input', updateAddButton);

  document.getElementById('addRule')?.addEventListener('click', async () => {
    const valueInput = document.getElementById('ruleValue') as HTMLInputElement;
    const value = valueInput.value.trim();

    if (value) {
      await addCustomRule({ type: 'content', value });
      currentSettings = await getSettings();
      renderChips();
      valueInput.value = '';
      updateAddButton();
    }
  });

  document.getElementById('ruleValue')?.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      document.getElementById('addRule')?.click();
    }
  });

  document.getElementById('customRules')?.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;
    const removeBtn = target.closest('.chip-remove') as HTMLElement;
    
    if (removeBtn) {
      const id = removeBtn.dataset.id!;
      await removeCustomRule(id);
      currentSettings = await getSettings();
      renderChips();
    }
  });
}

init();
