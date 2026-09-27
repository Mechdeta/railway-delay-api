import { expect, test, beforeAll, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

let app: Express;

beforeAll(async () => {
  // Set environment variables for x402 configuration (required by the app's validation, even though we're not using middleware in these tests)
  process.env.X402_PAY_TO = '0x1234567890123456789012345678901234567890';
  process.env.X402_NETWORK = 'eip155:84532';
  process.env.X402_FACILITATOR_URL = 'https://x402.org/facilitator';
  process.env.X402_PARSE_PRICE = '$0.001';
  process.env.X402_BULK_PRICE = '$0.005';

  // Reset module cache to pick up the new environment variables
  vi.resetModules();
  // Import the createApp function after setting environment variables
  const { createApp } = await import('../src/app');
  app = createApp();
});

test('GET /health returns status ok and service name', async () => {
  const response = await request(app).get('/health');
  expect(response.status).toBe(200);
  expect(response.body).toEqual({
    status: 'ok',
    service: 'railway-delay-api'
  });
});