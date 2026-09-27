import { expect, test, describe, beforeAll, afterAll, afterEach, vi, type Mock } from 'vitest';
import type { Express } from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { createBuyerClient, payAndParseNotice } from '../src/client/buyer';

let server: Server;
let apiUrl: string;
let mockVerify: Mock;
let mockSettle: Mock;
let mockGetSupported: Mock;

const setupEnv = (): void => {
  process.env.X402_PAY_TO = '0x1234567890123456789012345678901234567890';
  process.env.X402_NETWORK = 'eip155:84532';
  process.env.X402_FACILITATOR_URL = 'https://x402.org/facilitator';
  process.env.X402_PARSE_PRICE = '$0.001';
  process.env.X402_BULK_PRICE = '$0.005';
  delete process.env.BUYER_PRIVATE_KEY;
};

beforeAll(async () => {
  setupEnv();

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

  vi.resetModules();
  const { createApp } = await import('../src/app');
  const app: Express = createApp({ withPayment: true });

  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, () => {
      const address = server.address() as AddressInfo;
      apiUrl = `http://localhost:${address.port}`;
      resolve();
    });
    server.on('error', (err: Error) => reject(err));
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err?: Error) => {
      if (err) reject(err);
      else resolve();
    });
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('BUYER CLIENT UNIT & INTEGRATION TESTS', () => {
  test('createBuyerClient initializes x402HTTPClient with signer', async () => {
    const { httpClient, signer } = await createBuyerClient();
    expect(httpClient).toBeDefined();
    expect(signer).toBeDefined();
    expect(signer.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });

  test('payAndParseNotice successfully executes complete x402 payment flow', async () => {
    mockVerify.mockResolvedValueOnce({
      isValid: true,
      payer: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    });
    mockSettle.mockResolvedValueOnce({
      success: true,
      transaction: '0x1234567890abcdef',
      network: 'eip155:84532',
    });

    const result = await payAndParseNotice(
      'Train 12137 at NGP expected 14:35 due to signal failure',
      { apiUrl }
    );

    expect(result).toEqual({
      train: '12137',
      station: 'NGP',
      expectedTime: '14:35',
      reason: 'signal failure',
    });

    expect(mockVerify).toHaveBeenCalledTimes(1);
    expect(mockSettle).toHaveBeenCalledTimes(1);
  });

  test('payAndParseNotice handles unparseable notice and throws without settling', async () => {
    mockVerify.mockResolvedValueOnce({
      isValid: true,
      payer: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    });

    await expect(
      payAndParseNotice('completely unparseable notice', { apiUrl })
    ).rejects.toThrow(/Paid request failed with status 400/);

    expect(mockVerify).toHaveBeenCalledTimes(1);
    // Crucial requirement: settlement must not occur for an unparseable notice
    expect(mockSettle).not.toHaveBeenCalled();
  });
});
