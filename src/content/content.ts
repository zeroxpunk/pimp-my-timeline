import type { UserSettings, FilterResult } from '../types';
import { getAccountLocation, isLocationCached, getCachedLocation } from '../lib/x';
import { isHomeFeed, extractTweetId, extractTweetText, extractScreenName, hashText } from './dom';
import { getState, resetState, setPending, setApproved, setBlocked } from './ui';

let settings: UserSettings | null = null;

const tweetCache = new Map<string, { decision: 'approved' | 'blocked'; reason?: string }>();
const llmCache = new Map<string, { shouldHide: boolean; reason?: string }>();
const pendingTweets = new Map<string, { article: HTMLElement; text: string }>();
const locationFetchQueue = new Set<string>();

let isProcessing = false;
let visibilityObserver: IntersectionObserver | null = null;

async function loadSettings() {
  try {
    settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  } catch {
    settings = null;
  }
}

async function fetchLocation(screenName: string): Promise<string | null> {
  if (isLocationCached(screenName)) {
    return getCachedLocation(screenName) ?? null;
  }

  if (locationFetchQueue.has(screenName)) {
    return null;
  }

  locationFetchQueue.add(screenName);
  try {
    return await getAccountLocation(screenName);
  } finally {
    locationFetchQueue.delete(screenName);
  }
}

function matchesCountryRule(location: string | null): string | null {
  if (!location || !settings?.customRules) return null;

  const locationLower = location.toLowerCase();

  for (const rule of settings.customRules) {
    if (rule.type === 'country' && rule.enabled && locationLower.includes(rule.value.toLowerCase())) {
      return rule.value;
    }
  }

  return null;
}

function hasActiveCountryRules(): boolean {
  return settings?.customRules?.some(r => r.type === 'country' && r.enabled) ?? false;
}

function hasActiveContentRules(): boolean {
  return settings?.customRules?.some(r => r.type === 'content' && r.enabled) ?? false;
}

function applyCachedResult(article: HTMLElement, tweetId: string): boolean {
  const cached = tweetCache.get(tweetId);
  if (!cached) return false;

  if (cached.decision === 'approved') {
    setApproved(article);
  } else {
    setBlocked(article, cached.reason || 'Cached filter');
  }
  return true;
}

function approve(article: HTMLElement, tweetId?: string) {
  if (tweetId) {
    tweetCache.set(tweetId, { decision: 'approved' });
  }
  setApproved(article);
}

function block(article: HTMLElement, reason: string, tweetId?: string) {
  if (tweetId) {
    tweetCache.set(tweetId, { decision: 'blocked', reason });
  }
  setBlocked(article, reason);
}

async function processVisible() {
  if (isProcessing || pendingTweets.size === 0) return;

  isProcessing = true;
  const batch = Array.from(pendingTweets.entries());
  pendingTweets.clear();

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'FILTER_TWEETS',
      payload: {
        tweets: batch.map(([id, data]) => ({
          id,
          text: data.text,
          authorHandle: ''
        }))
      }
    });

    for (const [tweetId, data] of batch) {
      const textHash = hashText(data.text);
      const result = response?.results?.[tweetId] as FilterResult | undefined;

      llmCache.set(textHash, {
        shouldHide: result?.shouldHide || false,
        reason: result?.reason
      });

      if (result?.shouldHide) {
        block(data.article, result.reason || 'Content filtered', tweetId);
      } else {
        approve(data.article, tweetId);
      }
    }
  } catch {
    for (const [tweetId, data] of batch) {
      approve(data.article, tweetId);
    }
  }

  isProcessing = false;

  if (pendingTweets.size > 0) {
    processVisible();
  }
}

async function onTweetVisible(article: HTMLElement) {
  const screenName = extractScreenName(article);

  if (screenName && isHomeFeed() && hasActiveCountryRules()) {
    const location = await fetchLocation(screenName);
    const matchedCountry = matchesCountryRule(location);

    if (matchedCountry) {
      block(article, `Account based in ${matchedCountry}`, extractTweetId(article) ?? undefined);
      return;
    }
  }

  if (!isHomeFeed()) {
    approve(article);
    return;
  }

  const tweetId = extractTweetId(article);
  if (!tweetId) {
    approve(article);
    return;
  }

  if (applyCachedResult(article, tweetId)) {
    return;
  }

  const text = extractTweetText(article);
  const hasContentRules = settings?.customRules?.some(r => r.type === 'content' && r.enabled);

  if (!hasContentRules || !settings?.apiKey || !text) {
    approve(article, tweetId);
    return;
  }

  const textHash = hashText(text);
  const cachedLLM = llmCache.get(textHash);

  if (cachedLLM) {
    if (cachedLLM.shouldHide) {
      block(article, cachedLLM.reason || 'Content filtered', tweetId);
    } else {
      approve(article, tweetId);
    }
    return;
  }

  setPending(article);
  pendingTweets.set(tweetId, { article, text });
  processVisible();
}

function setupVisibilityObserver() {
  visibilityObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;

        const article = entry.target as HTMLElement;
        if (getState(article)) continue;

        visibilityObserver?.unobserve(article);
        onTweetVisible(article);
      }
    },
    { root: null, rootMargin: '100px', threshold: 0.1 }
  );
}

function observeArticle(article: HTMLElement) {
  if (getState(article)) return;

  if (!isHomeFeed() || !settings?.enabled) {
    approve(article);
    return;
  }

  const hasCountry = hasActiveCountryRules();
  const hasContent = hasActiveContentRules() && settings?.apiKey;

  if (!hasCountry && !hasContent) {
    approve(article);
    return;
  }

  visibilityObserver?.observe(article);
}

function observeTimeline() {
  setupVisibilityObserver();

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;

        if (node.tagName === 'ARTICLE') {
          observeArticle(node);
        } else {
          node.querySelectorAll('article').forEach(a => observeArticle(a as HTMLElement));
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  document.querySelectorAll('article').forEach(a => observeArticle(a as HTMLElement));
}

let lastUrl = location.href;
new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    document.querySelectorAll('article').forEach(article => {
      const el = article as HTMLElement;
      if (!getState(el)) {
        observeArticle(el);
      }
    });
  }
}).observe(document, { subtree: true, childList: true });

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'SETTINGS_UPDATED') {
    tweetCache.clear();
    llmCache.clear();
    pendingTweets.clear();

    loadSettings().then(() => {
      document.querySelectorAll('article').forEach(article => {
        resetState(article as HTMLElement);
        observeArticle(article as HTMLElement);
      });
    });
  }
});

async function init() {
  await loadSettings();

  const hasCountry = hasActiveCountryRules();
  const hasContent = hasActiveContentRules() && settings?.apiKey;

  if (settings?.enabled && (hasCountry || hasContent)) {
    observeTimeline();
  } else {
    document.querySelectorAll('article').forEach(a => approve(a as HTMLElement));
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
