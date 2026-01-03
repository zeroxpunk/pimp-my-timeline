import { request } from './client';
import type { AboutAccountResponse } from './types';

const ABOUT_ACCOUNT_ENDPOINT = 'zs_jFPFT78rBpXv9Z3U2YQ/AboutAccountQuery';

const locationCache = new Map<string, string | null>();

export async function getAccountLocation(screenName: string): Promise<string | null> {
  const cached = locationCache.get(screenName);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const data = await request<AboutAccountResponse>(ABOUT_ACCOUNT_ENDPOINT, { screenName });
    const location = data?.data?.user_result_by_screen_name?.result?.about_profile?.account_based_in ?? null;

    locationCache.set(screenName, location);
    return location;
  } catch {
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

