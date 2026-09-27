import { z } from 'zod';
import { delayNoticeSchema, type DelayNotice } from './delaySchema';

/**
 * Custom error for parsing failures
 */
export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

/**
 * Parse a railway delay notice string into structured data.
 * Uses regex to extract train number, station code, expected time, and optional reason.
 *
 * @param notice - The raw notice string
 * @returns Validated delay notice object
 * @throws ParseError if essential components cannot be extracted
 */
export function parseDelayNotice(notice: string): DelayNotice {
  if (!notice || typeof notice !== 'string') {
    throw new ParseError('Notice must be a non-empty string');
  }

  // Trim whitespace
  const cleaned = notice.trim();

  // Regex to capture:
  //   ^(?:Train\s+)?(\d+)        - train number (optional "Train " prefix)
  //   \s*(?:at\s+)?\s*           - optional "at" with surrounding whitespace
  //   ([A-Z]{3,4})               - station code (3-4 uppercase letters)
  //   \s+expected\s+             - whitespace, "expected", whitespace
  //   ([01]\d|2[0-3]):([0-5]\d)  - time in HH:MM (capture hours and minutes)
  //   \s*(?:due to\s+)?          - optional whitespace and "due to"
  //   (.*)$                      - remainder as reason (can be empty)
  const pattern = /^(?:Train\s+)?(\d+)\s*(?:at\s+)?\s*([A-Z]{3,4})\s+expected\s+([01]\d|2[0-3]):([0-5]\d)\s*(?:due to\s+)?(.*)$/;

  const match = cleaned.match(pattern);

  if (!match) {
    throw new ParseError('Unable to parse notice: missing train, station, or expected time');
  }

  const [, train, station, hours, minutes, reason] = match;

  // Construct the expectedTime string
  const expectedTime = `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`;

  // Prepare the result object
  const result = {
    train,
    station: station.toUpperCase(), // Normalize to uppercase
    expectedTime,
    reason: reason.trim() || undefined // Set to undefined if empty string after trim
  };

  // Validate against Zod schema
  const parsed = delayNoticeSchema.safeParse(result);
  if (!parsed.success) {
    // Format Zod error messages
    const errors = parsed.error.errors.map(err => err.message).join(', ');
    throw new ParseError(`Validation failed: ${errors}`);
  }

  return parsed.data;
}