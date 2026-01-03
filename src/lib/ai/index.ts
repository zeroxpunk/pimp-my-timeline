import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateObject } from 'ai';
import type { FilterRule, FilterResult } from '../../types';
import { BatchFilterResponseSchema, type TweetInput } from './types';
import { buildFilterPrompt } from './prompt';

const MODEL = 'gemini-2.5-flash';
const BATCH_SIZE = 8;
const MAX_CONCURRENT = 4;

export async function filterTweets(
  tweets: TweetInput[],
  rules: FilterRule[],
  apiKey: string
): Promise<Map<string, FilterResult>> {
  const results = new Map<string, FilterResult>();

  if (!apiKey || tweets.length === 0 || rules.length === 0) {
    return results;
  }

  const activeRules = rules.filter(r => r.enabled && r.type === 'content');
  if (activeRules.length === 0) {
    return results;
  }

  const google = createGoogleGenerativeAI({ apiKey });

  const batches: TweetInput[][] = [];
  for (let i = 0; i < tweets.length; i += BATCH_SIZE) {
    batches.push(tweets.slice(i, i + BATCH_SIZE));
  }

  const processBatch = async (batch: TweetInput[]): Promise<void> => {
    try {
      const { object } = await generateObject({
        model: google(MODEL),
        schema: BatchFilterResponseSchema,
        prompt: buildFilterPrompt(batch, activeRules)
      });

      for (const item of object.results) {
        results.set(item.id, {
          shouldHide: item.hide,
          matchedRule: item.rule
        });
      }
    } catch {
      for (const tweet of batch) {
        results.set(tweet.id, { shouldHide: false });
      }
    }
  };

  const semaphore = new Array(MAX_CONCURRENT).fill(Promise.resolve());
  let semIdx = 0;

  const tasks = batches.map(batch => {
    const idx = semIdx++ % MAX_CONCURRENT;
    semaphore[idx] = semaphore[idx].then(() => processBatch(batch));
    return semaphore[idx];
  });

  await Promise.all(tasks);

  return results;
}

export type { TweetInput } from './types';
