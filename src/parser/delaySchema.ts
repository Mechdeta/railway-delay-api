import { z } from 'zod';

export const delayNoticeSchema = z.object({
  train: z.string().regex(/^\d+$/, 'Train number must be numeric'),
  station: z.string().regex(/^[A-Z]{3,4}$/, 'Station code must be uppercase letters (3-4 characters)'),
  expectedTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Time must be in HH:MM 24-hour format'),
  reason: z.string().optional()
});

export type DelayNotice = z.infer<typeof delayNoticeSchema>;