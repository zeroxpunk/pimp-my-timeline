import type { UserSettings, FilterResult } from '../types';
import { getAccountLocation, isLocationCached, getCachedLocation } from '../lib/x';
import { isHomeFeed, extractTweetId, extractTweetText, extractScreenName, hashText, hasMedia } from './dom';
import { getState, resetState, setPending, setApproved, setBlocked } from './ui';

let settings: UserSettings | null = null;

const tweetCache = new Map<string, { decision: 'approved' | 'blocked'; rule?: string }>();
const llmCache = new Map<string, { shouldHide: boolean; rule?: string }>();
const pendingTweets = new Map<string, { article: HTMLElement; text: string }>();
const inFlightIds = new Set<string>();
const locationFetchQueue = new Set<string>();

const DEBOUNCE_MS = 100;
const BATCH_SIZE = 10;
const MAX_CONCURRENT_BATCHES = 3;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let activeBatches = 0;
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
    setBlocked(article, cached.rule || 'Filtered');
  }
  return true;
}

function approve(article: HTMLElement, tweetId?: string) {
  if (tweetId) {
    tweetCache.set(tweetId, { decision: 'approved' });
    inFlightIds.delete(tweetId);
  }
  setApproved(article);
}

function block(article: HTMLElement, rule: string, tweetId?: string) {
  if (tweetId) {
    tweetCache.set(tweetId, { decision: 'blocked', rule });
    inFlightIds.delete(tweetId);
  }
  setBlocked(article, rule);
}

async function processBatch(batch: Array<[string, { article: HTMLElement; text: string }]>) {
  if (batch.length === 0) return;

  activeBatches++;

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
        rule: result?.matchedRule
      });

      inFlightIds.delete(tweetId);

      if (result?.shouldHide) {
        block(data.article, result.matchedRule || 'Filtered', tweetId);
      } else {
        approve(data.article, tweetId);
      }
    }
  } catch {
    for (const [tweetId, data] of batch) {
      inFlightIds.delete(tweetId);
      approve(data.article, tweetId);
    }
  } finally {
    activeBatches--;
  }
}

function flushPending() {
  debounceTimer = null;

  if (pendingTweets.size === 0) return;

  const allPending = Array.from(pendingTweets.entries());
  pendingTweets.clear();

  const batches: Array<[string, { article: HTMLElement; text: string }]>[] = [];
  for (let i = 0; i < allPending.length; i += BATCH_SIZE) {
    batches.push(allPending.slice(i, i + BATCH_SIZE));
  }

  const processNext = () => {
    while (activeBatches < MAX_CONCURRENT_BATCHES && batches.length > 0) {
      const batch = batches.shift()!;
      processBatch(batch).then(() => {
        if (batches.length > 0) {
          processNext();
        }
      });
    }
  };

  processNext();
}

function scheduleFlush() {
  if (debounceTimer) return;
  debounceTimer = setTimeout(flushPending, DEBOUNCE_MS);
}

function queueTweet(tweetId: string, article: HTMLElement, text: string) {
  if (inFlightIds.has(tweetId)) return;
  if (pendingTweets.has(tweetId)) return;

  inFlightIds.add(tweetId);
  pendingTweets.set(tweetId, { article, text });
  scheduleFlush();
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

  if (hasMedia(article)) {
    approve(article, tweetId);
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
      block(article, cachedLLM.rule || 'Filtered', tweetId);
    } else {
      approve(article, tweetId);
    }
    return;
  }

  setPending(article);
  queueTweet(tweetId, article, text);
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
    { root: null, rootMargin: '200px', threshold: 0.1 }
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
    inFlightIds.clear();

    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

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
