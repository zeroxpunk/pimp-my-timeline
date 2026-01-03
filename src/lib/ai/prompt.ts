import type { FilterRule } from '../../types';
import type { TweetInput } from './types';

export function buildFilterPrompt(tweets: TweetInput[], rules: FilterRule[]): string {
  const rulesText = rules.map(r => `- ${r.value}`).join('\n');
  const tweetsText = tweets
    .map(t => `[${t.id}] ${t.text.slice(0, 280)}`)
    .join('\n---\n');

  return `Hide tweets matching rules. Return hide:true + rule (exact rule text) ONLY if clearly matches.

RULES:
${rulesText}

TWEETS:
${tweetsText}

Return {results:[{id,hide,rule?}]}. If hide:true, include the matching rule text. Be strict.`;
}
