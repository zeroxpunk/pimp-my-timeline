import type { UserSettings, FilterResult } from '../types';
import { getAccountLocation, isLocationCached, getCachedLocation } from '../lib/account-location';

let settings: UserSettings | null = null;

const tweetCache = new Map<string, { decision: 'approved' | 'blocked'; reason?: string }>();
const llmCache = new Map<string, { shouldHide: boolean; reason?: string }>();
const pendingTweets = new Map<string, { article: HTMLElement; text: string }>();
const locationFetchQueue = new Set<string>();

let isProcessing = false;
let visibilityObserver: IntersectionObserver | null = null;

function isHomeFeed(): boolean {
  const path = window.location.pathname;
  return path === '/home' || path === '/';
}

function hashText(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

async function loadSettings() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    settings = response;
  } catch (e) {
    console.error('[PimpTimeline] Settings load failed:', e);
  }
}

function extractTweetId(article: HTMLElement): string | null {
  const links = article.querySelectorAll('a[href*="/status/"]');
  for (const link of links) {
    const href = (link as HTMLAnchorElement).href;
    const match = href.match(/\/status\/(\d+)/);
    if (match) return match[1];
  }
  return null;
}

function extractTweetText(article: HTMLElement): string {
  const textEl = article.querySelector('[data-testid="tweetText"]');
  return textEl?.textContent?.trim() || '';
}

function extractScreenName(article: HTMLElement): string | null {
  const userLink = article.querySelector('a[href^="/"][role="link"]');
  if (userLink) {
    const href = (userLink as HTMLAnchorElement).href;
    const match = href.match(/x\.com\/([^/?]+)/);
    if (match && !['home', 'explore', 'notifications', 'messages', 'i'].includes(match[1])) {
      return match[1];
    }
  }
  return null;
}

async function fetchLocationForScreenName(screenName: string): Promise<string | null> {
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
  
  const countryRules = settings.customRules.filter(r => r.type === 'country' && r.enabled);
  const locationLower = location.toLowerCase();
  
  for (const rule of countryRules) {
    if (locationLower.includes(rule.value.toLowerCase())) {
      return rule.value;
    }
  }
  
  return null;
}

function getWrapper(article: HTMLElement): HTMLElement {
  let wrapper = article.parentElement;
  if (wrapper?.classList.contains('pimp-overlay-wrapper')) {
    return wrapper;
  }
  
  wrapper = document.createElement('div');
  wrapper.className = 'pimp-overlay-wrapper';
  article.parentElement?.insertBefore(wrapper, article);
  wrapper.appendChild(article);
  return wrapper;
}

function setPending(article: HTMLElement) {
  article.dataset.pimpPending = 'true';
  article.dataset.pimpApproved = '';
  article.dataset.pimpHidden = '';
  
  const wrapper = getWrapper(article);
  
  if (!wrapper.querySelector('.pimp-spinner')) {
    const spinner = document.createElement('div');
    spinner.className = 'pimp-spinner';
    spinner.innerHTML = '<div class="pimp-spinner-ring"></div>';
    wrapper.appendChild(spinner);
  }
}

function approve(article: HTMLElement, tweetId?: string) {
  article.dataset.pimpPending = '';
  article.dataset.pimpApproved = 'true';
  article.dataset.pimpHidden = '';
  
  if (tweetId) {
    tweetCache.set(tweetId, { decision: 'approved' });
  }
  
  const wrapper = article.parentElement;
  if (wrapper?.classList.contains('pimp-overlay-wrapper')) {
    wrapper.querySelector('.pimp-spinner')?.remove();
    wrapper.querySelector('.pimp-hidden-overlay')?.remove();
  }
}

function block(article: HTMLElement, reason: string, tweetId?: string) {
  article.dataset.pimpPending = '';
  article.dataset.pimpApproved = '';
  article.dataset.pimpHidden = 'true';
  
  if (tweetId) {
    tweetCache.set(tweetId, { decision: 'blocked', reason });
  }
  
  const wrapper = getWrapper(article);
  
  wrapper.querySelector('.pimp-spinner')?.remove();
  wrapper.querySelector('.pimp-hidden-overlay')?.remove();
  
  const overlay = document.createElement('div');
  overlay.className = 'pimp-hidden-overlay';
  
  const card = document.createElement('div');
  card.className = 'pimp-hidden-card';
  
  const title = document.createElement('div');
  title.className = 'pimp-hidden-title';
  title.textContent = 'Hidden';
  
  const reasonEl = document.createElement('div');
  reasonEl.className = 'pimp-hidden-reason';
  reasonEl.textContent = reason;
  
  const btn = document.createElement('button');
  btn.className = 'pimp-show-btn';
  btn.textContent = 'Reveal';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    article.dataset.pimpHidden = '';
    article.dataset.pimpApproved = 'true';
    overlay.remove();
  });
  
  card.appendChild(title);
  card.appendChild(reasonEl);
  card.appendChild(btn);
  overlay.appendChild(card);
  wrapper.appendChild(overlay);
}

function applyCachedResult(article: HTMLElement, tweetId: string): boolean {
  const cached = tweetCache.get(tweetId);
  if (!cached) return false;
  
  if (cached.decision === 'approved') {
    approve(article);
  } else {
    block(article, cached.reason || 'Cached filter');
  }
  return true;
}

async function onTweetVisible(article: HTMLElement) {
  const screenName = extractScreenName(article);
  
  console.log('[PimpTimeline] Processing tweet from:', screenName);
  
  if (screenName && isHomeFeed() && hasActiveCountryRules()) {
    console.log('[PimpTimeline] Fetching location for:', screenName);
    const location = await fetchLocationForScreenName(screenName);
    console.log('[PimpTimeline] Got location:', location, 'for:', screenName);
    
    const matchedCountry = matchesCountryRule(location);
    console.log('[PimpTimeline] Matched country rule:', matchedCountry);
    
    if (matchedCountry) {
      const tweetId = extractTweetId(article);
      console.log('[PimpTimeline] BLOCKING tweet from:', screenName, 'reason:', matchedCountry);
      block(article, `Account based in ${matchedCountry}`, tweetId ?? undefined);
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
  
  const contentRules = settings?.customRules?.filter(r => r.type === 'content') || [];
  
  if (!contentRules.length || !settings?.apiKey || !text) {
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
          authorHandle: '',
          authorName: ''
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
  } catch (e) {
    console.error('[PimpTimeline] LLM error:', e);
    for (const [tweetId, data] of batch) {
      approve(data.article, tweetId);
    }
  }
  
  isProcessing = false;
  
  if (pendingTweets.size > 0) {
    processVisible();
  }
}

function setupVisibilityObserver() {
  visibilityObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        
        const article = entry.target as HTMLElement;
        
        if (article.dataset.pimpPending || article.dataset.pimpApproved || article.dataset.pimpHidden) {
          continue;
        }
        
        visibilityObserver?.unobserve(article);
        onTweetVisible(article);
      }
    },
    {
      root: null,
      rootMargin: '100px',
      threshold: 0.1
    }
  );
}

function hasActiveCountryRules(): boolean {
  return settings?.customRules?.some(r => r.type === 'country' && r.enabled) ?? false;
}

function hasActiveContentRules(): boolean {
  return settings?.customRules?.some(r => r.type === 'content' && r.enabled) ?? false;
}

function observeArticle(article: HTMLElement) {
  if (article.dataset.pimpPending || article.dataset.pimpApproved || article.dataset.pimpHidden) {
    return;
  }
  
  if (!isHomeFeed()) {
    approve(article);
    return;
  }
  
  if (!settings?.enabled) {
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

// Listen for URL changes (SPA navigation)
let lastUrl = location.href;
new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    // Re-evaluate articles on navigation
    document.querySelectorAll('article').forEach(article => {
      const el = article as HTMLElement;
      // Reset state for re-evaluation
      if (!el.dataset.pimpApproved && !el.dataset.pimpHidden) {
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
        const el = article as HTMLElement;
        el.dataset.pimpPending = '';
        el.dataset.pimpApproved = '';
        el.dataset.pimpHidden = '';
        
        const wrapper = el.parentElement;
        if (wrapper?.classList.contains('pimp-overlay-wrapper')) {
          wrapper.querySelector('.pimp-spinner')?.remove();
          wrapper.querySelector('.pimp-hidden-overlay')?.remove();
        }
        
        observeArticle(el);
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
