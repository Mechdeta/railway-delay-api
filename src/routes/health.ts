import { Router, Request, Response } from 'express';

const router = Router();

/**
 * @route GET /health
 * @returns {Object} Health check response
 */
router.get('/', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'railway-delay-api'
  });
});

export default router;