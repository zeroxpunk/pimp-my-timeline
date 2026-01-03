const locationCache = new Map<string, string | null>();

const RATE_LIMIT = 50;
const RATE_WINDOW_MS = 10 * 60 * 1000;

let requestTimestamps: number[] = [];

function canMakeRequest(): boolean {
  const now = Date.now();
  requestTimestamps = requestTimestamps.filter(ts => now - ts < RATE_WINDOW_MS);
  return requestTimestamps.length < RATE_LIMIT;
}

function recordRequest(): void {
  requestTimestamps.push(Date.now());
}

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? match[2] : null;
}

export async function getAccountLocation(screenName: string): Promise<string | null> {
  if (locationCache.has(screenName)) {
    return locationCache.get(screenName) ?? null;
  }

  if (!canMakeRequest()) {
    console.log('[PimpTimeline] Rate limited, skipping request for:', screenName);
    return null;
  }

  const csrfToken = getCookie('ct0');
  if (!csrfToken) {
    console.log('[PimpTimeline] No csrf token found');
    return null;
  }

  try {
    const variables = JSON.stringify({ screenName });
    const url = `https://x.com/i/api/graphql/zs_jFPFT78rBpXv9Z3U2YQ/AboutAccountQuery?variables=${encodeURIComponent(variables)}`;

    recordRequest();

    console.log('[PimpTimeline] Fetching location for:', screenName);

    const response = await fetch(url, {
      credentials: 'include',
      headers: {
        'accept': '*/*',
        'authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
        'x-csrf-token': csrfToken,
        'x-twitter-active-user': 'yes',
        'x-twitter-auth-type': 'OAuth2Session',
        'x-twitter-client-language': 'en',
      }
    });

    console.log('[PimpTimeline] Response status:', response.status);

    if (!response.ok) {
      console.log('[PimpTimeline] Request failed for:', screenName, response.status);
      locationCache.set(screenName, null);
      return null;
    }

    const data = await response.json();
    console.log('[PimpTimeline] Response data for', screenName, ':', JSON.stringify(data, null, 2));
    
    const location = data?.data?.user_result_by_screen_name?.result?.about_profile?.account_based_in ?? null;
    
    console.log('[PimpTimeline] Location for', screenName, ':', location);
    
    locationCache.set(screenName, location);
    return location;
  } catch (e) {
    console.error('[PimpTimeline] Error fetching location for:', screenName, e);
    locationCache.set(screenName, null);
    return null;
  }
}

export function getCachedLocation(screenName: string): string | null | undefined {
  return locationCache.get(screenName);
}

export function isLocationCached(screenName: string): boolean {
  return locationCache.has(screenName);
}

