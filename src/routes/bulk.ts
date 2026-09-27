import { Router, Request, Response, NextFunction } from 'express';
import { parseDelayNotice, ParseError } from '../parser/delayParser';

const router = Router();
const MAX_NOTICES = 20;
const MAX_NOTICE_LENGTH = 2000; // same as the single parse route

/**
 * @route POST /parse/bulk
 * @param {Object} req.body - The request body
 * @param {Array<string>} req.body.notices - Array of railway delay notices to parse
 * @returns {Object} Parsed delay notices data
 */
router.post('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    // Validate request body
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'Invalid request body' });
    }

    const { notices } = req.body;

    // Validate notices array
    if (!Array.isArray(notices)) {
      return res.status(400).json({ error: 'Notices must be an array' });
    }

    if (notices.length === 0) {
      return res.status(400).json({ error: 'Notices array cannot be empty' });
    }

    if (notices.length > MAX_NOTICES) {
      return res.status(400).json({
        error: `Too many notices. Maximum allowed is ${MAX_NOTICES}.`
      });
    }

    // Parse each notice
    const results = [];
    for (const notice of notices) {
      if (typeof notice !== 'string') {
        return res.status(400).json({ error: 'Each notice must be a string' });
      }

      if (notice.length > MAX_NOTICE_LENGTH) {
        return res.status(413).json({
          error: `Notice too long. Maximum length is ${MAX_NOTICE_LENGTH} characters.`
        });
      }

      try {
        const parsed = parseDelayNotice(notice);
        results.push(parsed);
      } catch (error) {
        if (error instanceof ParseError) {
          return res.status(400).json({ error: error.message });
        }
        // Unexpected error
        next(error);
        return; // Important: return after calling next to avoid hanging response
      }
    }

    // Return success
    res.json({ results });
  } catch (error) {
    // Unexpected error
    next(error);
  }
});

export default router;