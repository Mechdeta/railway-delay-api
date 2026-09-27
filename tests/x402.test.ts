import { expect, test, describe, beforeAll, afterEach, vi, type Mock } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

// Set environment variables for x402 configuration
const setupEnv = (): void => {
  process.env.X402_PAY_TO = '0x1234567890123456789012345678901234567890';
  process.env.X402_NETWORK = 'eip155:84532';
  process.env.X402_FACILITATOR_URL = 'https://x402.org/facilitator';
  process.env.X402_PARSE_PRICE = '$0.001';
  process.env.X402_BULK_PRICE = '$0.005';
};

let app: Express;
let mockVerify: Mock;
let mockSettle: Mock;
let mockGetSupported: Mock;

function makePaymentHeader(options: { amount?: string; extra?: Record<string, unknown>; overrides?: Record<string, unknown> } = {}): string {
  const amount = options.amount ?? '1000';
  const accepted = {
    scheme: 'exact',
    network: 'eip155:84532',
    amount,
    asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    payTo: '0x1234567890123456789012345678901234567890',
    maxTimeoutSeconds: 300,
    extra: options.extra ?? { name: 'USDC', version: '2' },
  };

  const payload = {
    x402Version: 2,
    accepted,
    payload: {
      signature: '0x' + '1'.repeat(130),
      authorization: {
        from: '0x1234567890123456789012345678901234567890',
        to: '0x1234567890123456789012345678901234567890',
        value: amount,
        validAfter: '0',
        validBefore: '9999999999',
        nonce: '0x' + '0'.repeat(63) + '1',
      },
    },
    ...options.overrides,
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

beforeAll(async () => {
  setupEnv();

  // Mock HTTPFacilitatorClient
  mockVerify = vi.fn();
  mockSettle = vi.fn();
  mockGetSupported = vi.fn().mockResolvedValue({
    kinds: [
      {
        x402Version: 2,
        scheme: 'exact',
        network: 'eip155:84532',
        extra: {},
      },
    ],
    extensions: [],
    signers: {},
  });

  vi.mock('@x402/core/server', async () => {
    const actual = await vi.importActual<typeof import('@x402/core/server')>('@x402/core/server');
    return {
      ...actual,
      HTTPFacilitatorClient: class {
        readonly url: string;
        constructor(config?: { url?: string }) {
          this.url = config?.url ?? 'https://x402.org/facilitator';
        }
        getSupported = mockGetSupported;
        verify = mockVerify;
        settle = mockSettle;
      },
    };
  });

  // Reset module cache and import app
  vi.resetModules();
  const { app: importedApp } = await import('../src/app');
  app = importedApp as Express;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('FREE ROUTES', () => {
  test('GET /health returns 200 without payment headers', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'ok',
      service: 'railway-delay-api',
    });
    expect(response.headers).not.toHaveProperty('accept-payment');
    expect(response.headers).not.toHaveProperty('payment-required');
  });

  test('GET / returns 200 without payment headers', async () => {
    const response = await request(app).get('/');
    expect(response.status).toBe(200);
    expect(response.text).toBe('Railway Delay API is running');
    expect(response.headers).not.toHaveProperty('accept-payment');
    expect(response.headers).not.toHaveProperty('payment-required');
  });
});

describe('POST /parse (Single Parse)', () => {
  test('without payment returns 402 and payment requirements', async () => {
    const response = await request(app)
      .post('/parse')
      .send({ notice: '12137 at NGP expected 14:35 due to signal failure' })
      .expect(402);

    expect(response.headers).toHaveProperty('accept-payment');
    const acceptPayment = response.headers['accept-payment'];
    expect(acceptPayment).toContain('eip155:84532');
    expect(acceptPayment).toContain('$0.001');
    expect(acceptPayment).toContain('0x1234567890123456789012345678901234567890');
    expect(response.headers).toHaveProperty('payment-required');
  });

  test('with verified payment returns parser result and settles payment', async () => {
    mockVerify.mockResolvedValueOnce({
      isValid: true,
      payer: '0x1234567890123456789012345678901234567890',
    });
    mockSettle.mockResolvedValueOnce({
      success: true,
      transaction: '0xabcdef',
      network: 'eip155:84532',
    });

    const response = await request(app)
      .post('/parse')
      .set('payment-signature', makePaymentHeader())
      .send({ notice: '12137 at NGP expected 14:35 due to signal failure' })
      .expect(200);

    expect(response.body).toEqual({
      train: '12137',
      station: 'NGP',
      expectedTime: '14:35',
      reason: 'signal failure',
    });

    expect(mockVerify).toHaveBeenCalledTimes(1);
    expect(mockSettle).toHaveBeenCalledTimes(1);
  });

  test('malformed notice with verified payment returns 400 and DOES NOT settle', async () => {
    mockVerify.mockResolvedValueOnce({
      isValid: true,
      payer: '0x1234567890123456789012345678901234567890',
    });

    const response = await request(app)
      .post('/parse')
      .set('payment-signature', makePaymentHeader())
      .send({ notice: 'invalid notice' })
      .expect(400);

    expect(response.body).toHaveProperty('error');
    // Critical: settlement must NOT be called because the parser could not read the notice
    expect(mockSettle).not.toHaveBeenCalled();
  });

  test('oversized notice with verified payment returns 413 and DOES NOT settle', async () => {
    mockVerify.mockResolvedValueOnce({
      isValid: true,
      payer: '0x1234567890123456789012345678901234567890',
    });

    const oversizedNotice = 'x'.repeat(2001);
    await request(app)
      .post('/parse')
      .set('payment-signature', makePaymentHeader())
      .send({ notice: oversizedNotice })
      .expect(413);

    // Critical: settlement must NOT be called on oversized notices
    expect(mockSettle).not.toHaveBeenCalled();
  });

  test('request body cannot override price', async () => {
    mockVerify.mockResolvedValueOnce({
      isValid: true,
      payer: '0x1234567890123456789012345678901234567890',
    });
    mockSettle.mockResolvedValueOnce({
      success: true,
      transaction: '0xabcdef',
      network: 'eip155:84532',
    });

    const response = await request(app)
      .post('/parse')
      .set('payment-signature', makePaymentHeader())
      .send({
        notice: '12137 at NGP expected 14:35 due to signal failure',
        price: '$0.005', // Attempt to override price
      })
      .expect(200);

    expect(response.body).toEqual({
      train: '12137',
      station: 'NGP',
      expectedTime: '14:35',
      reason: 'signal failure',
    });
  });

  test('request body cannot override payTo', async () => {
    mockVerify.mockResolvedValueOnce({
      isValid: true,
      payer: '0x1234567890123456789012345678901234567890',
    });
    mockSettle.mockResolvedValueOnce({
      success: true,
      transaction: '0xabcdef',
      network: 'eip155:84532',
    });

    const response = await request(app)
      .post('/parse')
      .set('payment-signature', makePaymentHeader())
      .send({
        notice: '12137 at NGP expected 14:35 due to signal failure',
        payTo: '0x0000000000000000000000000000000000000000', // Attempt to override payTo
      })
      .expect(200);

    expect(response.body).toEqual({
      train: '12137',
      station: 'NGP',
      expectedTime: '14:35',
      reason: 'signal failure',
    });
  });
});

describe('POST /parse/bulk (Bulk Parse)', () => {
  test('without payment returns 402 and bulk payment requirements', async () => {
    const response = await request(app)
      .post('/parse/bulk')
      .send({
        notices: [
          '12137 at NGP expected 14:35 due to signal failure',
          '11010 at PUNE expected 16:20 due to signal failure',
        ],
      })
      .expect(402);

    expect(response.headers).toHaveProperty('accept-payment');
    const acceptPayment = response.headers['accept-payment'];
    expect(acceptPayment).toContain('eip155:84532');
    expect(acceptPayment).toContain('$0.005'); // bulk price differs from single parse ($0.001)
    expect(acceptPayment).toContain('0x1234567890123456789012345678901234567890');
    expect(response.headers).toHaveProperty('payment-required');
  });

  test('with verified payment returns bulk parser result and settles payment', async () => {
    mockVerify.mockResolvedValueOnce({
      isValid: true,
      payer: '0x1234567890123456789012345678901234567890',
    });
    mockSettle.mockResolvedValueOnce({
      success: true,
      transaction: '0xabcdef',
      network: 'eip155:84532',
    });

    const response = await request(app)
      .post('/parse/bulk')
      .set('payment-signature', makePaymentHeader({ amount: '5000' }))
      .send({
        notices: [
          '12137 at NGP expected 14:35 due to signal failure',
          '11010 at PUNE expected 16:20 due to signal failure',
        ],
      })
      .expect(200);

    expect(response.body).toEqual({
      results: [
        {
          train: '12137',
          station: 'NGP',
          expectedTime: '14:35',
          reason: 'signal failure',
        },
        {
          train: '11010',
          station: 'PUNE',
          expectedTime: '16:20',
          reason: 'signal failure',
        },
      ],
    });

    expect(mockVerify).toHaveBeenCalledTimes(1);
    expect(mockSettle).toHaveBeenCalledTimes(1);
  });

  test('malformed notice in bulk with verified payment returns 400 and DOES NOT settle', async () => {
    mockVerify.mockResolvedValueOnce({
      isValid: true,
      payer: '0x1234567890123456789012345678901234567890',
    });

    const response = await request(app)
      .post('/parse/bulk')
      .set('payment-signature', makePaymentHeader({ amount: '5000' }))
      .send({
        notices: [
          '12137 at NGP expected 14:35 due to signal failure',
          'invalid notice',
        ],
      })
      .expect(400);

    expect(response.body).toHaveProperty('error');
    // Critical: settlement must NOT be called when bulk parse fails
    expect(mockSettle).not.toHaveBeenCalled();
  });

  test('oversized notice in bulk with verified payment returns 413 and DOES NOT settle', async () => {
    mockVerify.mockResolvedValueOnce({
      isValid: true,
      payer: '0x1234567890123456789012345678901234567890',
    });

    const oversizedNotice = 'x'.repeat(2001);
    await request(app)
      .post('/parse/bulk')
      .set('payment-signature', makePaymentHeader({ amount: '5000' }))
      .send({
        notices: [
          '12137 at NGP expected 14:35 due to signal failure',
          oversizedNotice,
        ],
      })
      .expect(413);

    expect(mockSettle).not.toHaveBeenCalled();
  });

  test('too many notices (over 20) returns 400 and DOES NOT settle', async () => {
    mockVerify.mockResolvedValueOnce({
      isValid: true,
      payer: '0x1234567890123456789012345678901234567890',
    });

    const notices = Array(21).fill('12137 at NGP expected 14:35 due to signal failure');
    await request(app)
      .post('/parse/bulk')
      .set('payment-signature', makePaymentHeader({ amount: '5000' }))
      .send({ notices })
      .expect(400);

    expect(mockSettle).not.toHaveBeenCalled();
  });

  test('individual notice over 2000 characters returns 413 and DOES NOT settle', async () => {
    mockVerify.mockResolvedValueOnce({
      isValid: true,
      payer: '0x1234567890123456789012345678901234567890',
    });

    const oversizedNotice = 'x'.repeat(2001);
    await request(app)
      .post('/parse/bulk')
      .set('payment-signature', makePaymentHeader({ amount: '5000' }))
      .send({ notices: [oversizedNotice] })
      .expect(413);

    expect(mockSettle).not.toHaveBeenCalled();
  });
});