import express, { Application, Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import healthRouter from './routes/health';
import parseRouter from './routes/parse';
import bulkRouter from './routes/bulk';
import { HTTPFacilitatorClient, RoutesConfig } from '@x402/core/server';
import { Network } from '@x402/core/types';
import { paymentMiddlewareFromConfig, SchemeRegistration } from '@x402/express';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { X402Config } from './payment/x402';

dotenv.config();

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

/**
 * Creates an Express app.
 * @param {Object} options - Configuration options
 * @param {boolean} options.withPayment - Whether to mount paid routes with x402 middleware
 */
export function createApp(options: { withPayment?: boolean } = {}): Application {
  const { withPayment = false } = options;
  const app: Application = express();

  // Middleware for parsing JSON requests with 100kb limit
  app.use(express.json({ limit: '100kb' }));

  // Free routes
  app.use('/health', healthRouter);
  app.get('/', (req: Request, res: Response) => {
    res.send('Railway Delay API is running');
  });

  if (withPayment) {
    X402Config.validate();

    const facilitatorClient = new HTTPFacilitatorClient({
      url: X402Config.FACILITATOR_URL,
    });

    const schemes: SchemeRegistration[] = [
      {
        network: X402Config.NETWORK as Network,
        server: new ExactEvmScheme(),
      },
    ];

    const routesConfig: RoutesConfig = {
      'POST /parse': {
        accepts: {
          scheme: 'exact',
          payTo: X402Config.PAY_TO,
          price: X402Config.PARSE_PRICE,
          network: X402Config.NETWORK as Network,
        },
        resource: 'parse',
        description: 'Parse railway delay notice',
        mimeType: 'application/json',
      },
      'POST /parse/bulk': {
        accepts: {
          scheme: 'exact',
          payTo: X402Config.PAY_TO,
          price: X402Config.BULK_PRICE,
          network: X402Config.NETWORK as Network,
        },
        resource: 'parse/bulk',
        description: 'Parse bulk railway delay notices',
        mimeType: 'application/json',
      },
    };

    const x402Middleware = paymentMiddlewareFromConfig(
      routesConfig,
      facilitatorClient,
      schemes
    );

    // Header compatibility wrapper to provide accept-payment alongside payment-required
    app.use((req: Request, res: Response, next: NextFunction) => {
      const originalSetHeader = res.setHeader.bind(res);
      res.setHeader = function (name: string, value: number | string | readonly string[]) {
        if (typeof name === 'string' && name.toLowerCase() === 'payment-required') {
          const price = req.path.startsWith('/parse/bulk')
            ? X402Config.BULK_PRICE
            : X402Config.PARSE_PRICE;
          originalSetHeader(
            'accept-payment',
            `scheme=exact, network=${X402Config.NETWORK}, price=${price}, payTo=${X402Config.PAY_TO}`
          );
        }
        return originalSetHeader(name, value);
      };
      next();
    });

    // Mount x402 payment middleware at root to intercept configured routes by full path
    app.use(x402Middleware);

    // Route handlers
    app.use('/parse', parseRouter);
    app.use('/parse/bulk', bulkRouter);
  }

  return app;
}

// Default export app for production and x402 integration tests
const app: Application = createApp({ withPayment: true });

export { app, PORT };