import dotenv from 'dotenv';
import { x402Client, x402HTTPClient } from '@x402/core/client';
import type { PaymentRequired } from '@x402/core/types';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import type { ClientEvmSigner } from '@x402/evm';
import type { DelayNotice } from '../parser/delaySchema';

dotenv.config();

const BASE_SEPOLIA_NETWORK = 'eip155:84532';

export interface BuyerClientContext {
  httpClient: x402HTTPClient;
  signer: ClientEvmSigner;
}

export interface BuyerOptions {
  apiUrl?: string;
  privateKey?: string;
}

/**
 * Creates and configures an x402 client and EVM signer for the buyer.
 * Uses BUYER_PRIVATE_KEY from environment, or generates an ephemeral key if not provided.
 */
export async function createBuyerClient(privateKeyOverride?: string): Promise<BuyerClientContext> {
  const { privateKeyToAccount, generatePrivateKey } = await import('viem/accounts');

  const privateKey = privateKeyOverride ?? process.env.BUYER_PRIVATE_KEY;
  let keyToUse: `0x${string}`;

  if (privateKey && privateKey.startsWith('0x') && privateKey.length === 66) {
    keyToUse = privateKey as `0x${string}`;
  } else {
    // Generate an ephemeral key for test/demonstration when no key is explicitly configured
    keyToUse = generatePrivateKey();
  }

  const account = privateKeyToAccount(keyToUse);

  const client = new x402Client();
  registerExactEvmScheme(client, { signer: account });
  const httpClient = new x402HTTPClient(client);

  return { httpClient, signer: account };
}

/**
 * Sends a delay notice to the paid /parse endpoint, handles the 402 response,
 * discovers server payment requirements, signs the payment using the x402 client,
 * retries the request, and returns the parsed DelayNotice result.
 */
export async function payAndParseNotice(
  notice: string,
  options?: BuyerOptions
): Promise<DelayNotice> {
  const apiUrl = (options?.apiUrl ?? process.env.API_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const { httpClient, signer } = await createBuyerClient(options?.privateKey);

  console.log(`[Buyer] Target API: ${apiUrl}/parse`);
  console.log(`[Buyer] Payer Address: ${signer.address}`);
  console.log(`[Buyer] Notice: "${notice}"`);

  // Step 1: Initial request to paid endpoint without payment
  console.log('[Buyer] Step 1: Sending initial request (expecting 402 Payment Required)...');
  const initialResponse = await fetch(`${apiUrl}/parse`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ notice }),
  });

  if (initialResponse.status === 200) {
    console.log('[Buyer] Request succeeded without payment (endpoint was free).');
    return (await initialResponse.json()) as DelayNotice;
  }

  if (initialResponse.status !== 402) {
    const errorText = await initialResponse.text();
    throw new Error(
      `Unexpected initial response status: ${initialResponse.status} ${initialResponse.statusText}. Response: ${errorText}`
    );
  }

  // Step 2: Discover and validate payment requirements from server 402 response
  console.log('[Buyer] Step 2: Discovered 402 Payment Required from server.');
  const paymentRequired: PaymentRequired = httpClient.getPaymentRequiredResponse(
    (name: string) => initialResponse.headers.get(name)
  );

  const matchedAccept = paymentRequired.accepts.find(
    (req: { network?: string }) => req.network === BASE_SEPOLIA_NETWORK
  );

  if (!matchedAccept) {
    throw new Error(
      `Server does not accept required network ${BASE_SEPOLIA_NETWORK}. Available networks: ${paymentRequired.accepts.map((a: { network?: string }) => a.network).join(', ')}`
    );
  }

  console.log('[Buyer] Discovered Server Payment Requirements:');
  console.log(`  - Network:  ${matchedAccept.network} (Base Sepolia)`);
  console.log(`  - Amount:   ${matchedAccept.amount} atomic units (USDC)`);
  console.log(`  - Asset:    ${matchedAccept.asset}`);
  console.log(`  - Pay To:   ${matchedAccept.payTo}`);
  console.log(`  - Scheme:   ${matchedAccept.scheme}`);

  // Step 3: Create and sign payment payload using x402 client
  console.log('[Buyer] Step 3: Generating and signing x402 payment payload...');
  const paymentPayload = await httpClient.createPaymentPayload(paymentRequired);
  const paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);

  // Step 4: Retry request with signed payment header
  console.log('[Buyer] Step 4: Sending paid request with PAYMENT-SIGNATURE header...');
  const paidResponse = await fetch(`${apiUrl}/parse`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...paymentHeaders,
    },
    body: JSON.stringify({ notice }),
  });

  if (!paidResponse.ok) {
    const errorBody = await paidResponse.text();
    throw new Error(
      `Paid request failed with status ${paidResponse.status} ${paidResponse.statusText}: ${errorBody}`
    );
  }

  // Step 5: Process and return parsed JSON
  const parsedData = (await paidResponse.json()) as DelayNotice;
  console.log('[Buyer] Step 5: Success! Received structured JSON response:');
  console.log(JSON.stringify(parsedData, null, 2));

  return parsedData;
}

// Direct CLI execution
if (require.main === module) {
  const sampleNotice =
    process.argv.slice(2).join(' ').trim() ||
    'Train 12137 at NGP expected 14:35 due to signal failure';

  payAndParseNotice(sampleNotice)
    .then(() => {
      process.exit(0);
    })
    .catch((error: Error) => {
      console.error('[Buyer] Error:', error.message);
      process.exit(1);
    });
}
