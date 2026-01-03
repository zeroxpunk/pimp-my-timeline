import type { FilterRule } from '../../types';
import type { TweetInput } from './types';

export function buildFilterPrompt(tweets: TweetInput[], rules: FilterRule[]): string {
  const rulesText = rules.map(r => `- Hide: ${r.value}`).join('\n');
  const tweetsText = tweets
    .map(t => `[${t.id}] @${t.authorHandle}: ${t.text.slice(0, 300)}`)
    .join('\n\n');

  return `Check these tweets against hide rules. Return hide=true only if tweet clearly matches a rule.

Rules:
${rulesText}

Tweets:
${tweetsText}

Be strict. Only hide if content clearly matches.`;
}

