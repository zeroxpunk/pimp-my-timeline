import { UserSettings, DEFAULT_SETTINGS } from '../types';

const STORAGE_KEY = 'pimpMyTimeline';

export async function getSettings(): Promise<UserSettings> {
  const result = await chrome.storage.sync.get(STORAGE_KEY);
  return { ...DEFAULT_SETTINGS, ...result[STORAGE_KEY] };
}

export async function saveSettings(settings: Partial<UserSettings>): Promise<void> {
  const current = await getSettings();
  const updated = { ...current, ...settings };
  await chrome.storage.sync.set({ [STORAGE_KEY]: updated });
}

export async function addCustomRule(rule: { type: 'country' | 'content' | 'custom'; value: string }): Promise<void> {
  const settings = await getSettings();
  const newRule = {
    id: crypto.randomUUID(),
    type: rule.type,
    value: rule.value,
    enabled: true
  };
  settings.customRules.push(newRule);
  await saveSettings(settings);
}

export async function removeCustomRule(ruleId: string): Promise<void> {
  const settings = await getSettings();
  settings.customRules = settings.customRules.filter(r => r.id !== ruleId);
  await saveSettings(settings);
}

