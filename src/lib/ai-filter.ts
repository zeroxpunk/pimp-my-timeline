import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateObject } from 'ai';
import { z } from 'zod';
import type { TweetData, FilterRule, FilterResult } from '../types';

const batchFilterSchema = z.object({
  results: z.array(z.object({
    id: z.string(),
    hide: z.boolean(),
    reason: z.string().optional()
  }))
});

export async function filterTweets(
  tweets: Omit<TweetData, 'element'>[],
  rules: FilterRule[],
  apiKey: string
): Promise<Map<string, FilterResult>> {
  if (!apiKey || tweets.length === 0 || rules.length === 0) {
    return new Map();
  }

  const activeRules = rules.filter(r => r.enabled);
  if (activeRules.length === 0) {
    return new Map();
  }

  const google = createGoogleGenerativeAI({ apiKey });

  const rulesText = activeRules.map(r => `- Hide: ${r.value}`).join('\n');

  try {
    const { object } = await generateObject({
      model: google('gemini-2.5-flash'),
      schema: batchFilterSchema,
      prompt: `Check these tweets against hide rules. Return hide=true only if tweet clearly matches a rule.

Rules:
${rulesText}

Tweets:
${tweets.map(t => `[${t.id}] @${t.authorHandle}: ${t.text.slice(0, 300)}`).join('\n\n')}

Be strict. Only hide if content clearly matches.`
    });

    const results = new Map<string, FilterResult>();
    object.results.forEach(r => {
      results.set(r.id, {
        shouldHide: r.hide,
        reason: r.reason
      });
    });

    return results;
  } catch (error) {
    console.error('AI filter error:', error);
    return new Map();
  }
}
