import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateObject } from 'ai';
import type { FilterRule, FilterResult } from '../../types';
import { BatchFilterResponseSchema, type TweetInput } from './types';
import { buildFilterPrompt } from './prompt';

const MODEL = 'gemini-2.5-flash';

export async function filterTweets(
  tweets: TweetInput[],
  rules: FilterRule[],
  apiKey: string
): Promise<Map<string, FilterResult>> {
  const results = new Map<string, FilterResult>();

  if (!apiKey || tweets.length === 0 || rules.length === 0) {
    return results;
  }

  const activeRules = rules.filter(r => r.enabled);
  if (activeRules.length === 0) {
    return results;
  }

  const google = createGoogleGenerativeAI({ apiKey });

  try {
    const { object } = await generateObject({
      model: google(MODEL),
      schema: BatchFilterResponseSchema,
      prompt: buildFilterPrompt(tweets, activeRules)
    });

    for (const item of object.results) {
      results.set(item.id, {
        shouldHide: item.hide,
        reason: item.reason
      });
    }
  } catch {
    return results;
  }

  return results;
}

export type { TweetInput } from './types';

