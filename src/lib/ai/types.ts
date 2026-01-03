import { z } from 'zod';

export const FilterResultSchema = z.object({
  id: z.string(),
  hide: z.boolean(),
  reason: z.string().optional()
});

export const BatchFilterResponseSchema = z.object({
  results: z.array(FilterResultSchema)
});

export interface TweetInput {
  id: string;
  text: string;
  authorHandle: string;
}


