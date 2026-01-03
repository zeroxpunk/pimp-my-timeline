const RESERVED_PATHS = ['home', 'explore', 'notifications', 'messages', 'i'];

export function isHomeFeed(): boolean {
  const path = window.location.pathname;
  return path === '/home' || path === '/';
}

export function extractTweetId(article: HTMLElement): string | null {
  const links = article.querySelectorAll('a[href*="/status/"]');
  for (const link of links) {
    const href = (link as HTMLAnchorElement).href;
    const match = href.match(/\/status\/(\d+)/);
    if (match) return match[1];
  }
  return null;
}

export function extractTweetText(article: HTMLElement): string {
  const textEl = article.querySelector('[data-testid="tweetText"]');
  return textEl?.textContent?.trim() || '';
}

export function extractScreenName(article: HTMLElement): string | null {
  const userLink = article.querySelector('a[href^="/"][role="link"]');
  if (!userLink) return null;

  const href = (userLink as HTMLAnchorElement).href;
  const match = href.match(/x\.com\/([^/?]+)/);

  if (match && !RESERVED_PATHS.includes(match[1])) {
    return match[1];
  }

  return null;
}

export function hashText(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

