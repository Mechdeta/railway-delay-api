import { expect, test, describe, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import parseRouter from '../src/routes/parse';
import bulkRouter from '../src/routes/bulk';

import type { Express } from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

let app: Express;
let server: Server;
let baseUrl: string;

// Set environment variables for x402 configuration
const setupEnv = () => {
  process.env.X402_PAY_TO = '0x1234567890123456789012345678901234567890';
  process.env.X402_NETWORK = 'eip155:84532';
  process.env.X402_FACILITATOR_URL = 'https://x402.org/facilitator';
  process.env.X402_PARSE_PRICE = '$0.001';
  process.env.X402_BULK_PRICE = '$0.005';
};

beforeAll(async () => {
  setupEnv();
  vi.resetModules();
  // Import the createApp function after setting environment variables
  const { createApp } = await import('../src/app');
  app = createApp();

  // Mount the parse and bulk routes without middleware (as in the original app)
  app.use('/parse', parseRouter);
  app.use('/parse/bulk', bulkRouter);

  // Start server for supertest
  return new Promise((resolve, reject) => {
    server = app.listen(0);
    server.on('listening', () => {
      const address = server.address() as AddressInfo;
      const port = address.port;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
    server.on('error', (err) => {
      reject(err);
    });
  });
});

afterAll(() => {
  server.close();
});

describe('POST /parse', () => {
  test('normal valid notice', async () => {
    const response = await request(baseUrl)
      .post('/parse')
      .send({ notice: '12137 at NGP expected 14:35 due to signal failure' })
      .expect(200);

    expect(response.body).toEqual({
      train: '12137',
      station: 'NGP',
      expectedTime: '14:35',
      reason: 'signal failure'
    });
  });

  test('notice with Train prefix', async () => {
    const response = await request(baseUrl)
      .post('/parse')
      .send({ notice: 'Train 12137 at NGP expected 14:35 due to signal failure' })
      .expect(200);

    expect(response.body).toEqual({
      train: '12137',
      station: 'NGP',
      expectedTime: '14:35',
      reason: 'signal failure'
    });
  });

  test('valid notice with Hindi reason', async () => {
    const response = await request(baseUrl)
      .post('/parse')
      .send({ notice: '12137 at NGP expected 14:35 due to संकेत विफलता' })
      .expect(200);

    expect(response.body).toEqual({
      train: '12137',
      station: 'NGP',
      expectedTime: '14:35',
      reason: 'संकेत विफलता'
    });
  });

  test('missing train returns 400', async () => {
    await request(baseUrl)
      .post('/parse')
      .send({ notice: 'at NGP expected 14:35 due to signal failure' })
      .expect(400);
  });

  test('missing station returns 400', async () => {
    await request(baseUrl)
      .post('/parse')
      .send({ notice: '12137 at expected 14:35 due to signal failure' })
      .expect(400);
  });

  test('missing expected time returns 400', async () => {
    await request(baseUrl)
      .post('/parse')
      .send({ notice: '12137 at NGP expected due to signal failure' })
      .expect(400);
  });

  test('garbage input returns 400', async () => {
    await request(baseUrl)
      .post('/parse')
      .send({ notice: 'this is completely garbage' })
      .expect(400);
  });

  test('oversized notice returns 413', async () => {
    const oversizedNotice = 'x'.repeat(2001);
    await request(baseUrl)
      .post('/parse')
      .send({ notice: oversizedNotice })
      .expect(413);
  });

  test('schema validation failure (lowercase station) returns 400', async () => {
    // This notice would pass regex but station is lowercase
    await request(baseUrl)
      .post('/parse')
      .send({ notice: '12137 at ngp expected 14:35 due to signal failure' })
      .expect(400);
  });

  test('invalid request body (missing notice) returns 400', async () => {
    await request(baseUrl)
      .post('/parse')
      .send({})
      .expect(400);
  });

  test('notice is not a string returns 400', async () => {
    await request(baseUrl)
      .post('/parse')
      .send({ notice: 123 })
      .expect(400);
  });
});