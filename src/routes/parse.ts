import { Router, Request, Response, NextFunction } from 'express';
import { parseDelayNotice, ParseError } from '../parser/delayParser';

const router = Router();
const MAX_NOTICE_LENGTH = parseInt(process.env.MAX_NOTICE_LENGTH || '2000', 10);

/**
 * @route POST /parse
 * @param {Object} req.body - The request body
 * @param {string} req.body.notice - The railway delay notice to parse
 * @returns {Object} Parsed delay notice data
 */
router.post('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    // Validate request body
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'Invalid request body' });
    }

    const { notice } = req.body;

    if (typeof notice !== 'string') {
      return res.status(400).json({ error: 'Notice must be a string' });
    }

    // Check notice length
    if (notice.length > MAX_NOTICE_LENGTH) {
      return res.status(413).json({
        error: `Notice too long. Maximum length is ${MAX_NOTICE_LENGTH} characters.`
      });
    }

    // Parse the notice
    const result = parseDelayNotice(notice);

    // Return success
    res.json(result);
  } catch (error) {
    if (error instanceof ParseError) {
      return res.status(400).json({ error: error.message });
    }
    // Unexpected error
    next(error);
  }
});

export default router;