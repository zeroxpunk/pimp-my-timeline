export interface FilterRule {
  id: string;
  type: 'country' | 'content' | 'custom';
  value: string;
  enabled: boolean;
}

export interface UserSettings {
  enabled: boolean;
  apiKey: string;
  hiddenCountries: string[];
  customRules: FilterRule[];
  showCountryFlags: boolean;
}

export interface TweetData {
  id: string;
  text: string;
  authorHandle: string;
  authorName: string;
  element: HTMLElement;
}

export interface FilterResult {
  shouldHide: boolean;
  matchedRule?: string;
  detectedCountry?: string;
}

export interface Message {
  type: 'FILTER_TWEETS' | 'GET_SETTINGS' | 'SAVE_SETTINGS' | 'DETECT_COUNTRY';
  payload?: unknown;
}

export const DEFAULT_SETTINGS: UserSettings = {
  enabled: true,
  apiKey: '',
  hiddenCountries: [],
  customRules: [],
  showCountryFlags: true
};
