import { getSettings } from '../lib/storage';
import { filterTweets, type TweetInput } from '../lib/ai';
import type { Message } from '../types';

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse);
  return true;
});

async function handleMessage(message: Message) {
  switch (message.type) {
    case 'GET_SETTINGS': {
      return await getSettings();
    }

    case 'FILTER_TWEETS': {
      const settings = await getSettings();
      if (!settings.enabled || !settings.apiKey || settings.customRules.length === 0) {
        return { results: {} };
      }

      const payload = message.payload as { tweets: TweetInput[] };

      const results = await filterTweets(
        payload.tweets,
        settings.customRules,
        settings.apiKey
      );

      return { results: Object.fromEntries(results) };
    }

    default:
      return null;
  }
}
