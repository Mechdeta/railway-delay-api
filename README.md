# The Operator's Booth: Meera's Railway Delay API

A resilient, micro-monetized Express API built in TypeScript that ingests unstructured railway delay announcements and returns validated, structured JSON. Paid routes are protected by the **x402 open payment protocol** on the **Base Sepolia testnet** using test **USDC**.

---

## Overview

Railway delay notices from operational announcement boards are notoriously messy and irregular (containing inconsistent prefixes, variable whitespace, Hindi or multilingual operational reasons, and missing fields).

**The Operator's Booth: Meera's Railway Delay API** parses and normalizes these messy announcements into clean, schema-validated JSON objects ready for operational boards, downstream traveler alerts, and dispatch dashboards.

### Core Principle
> **"NOBODY PAYS FOR A NOTICE THE PARSER COULDN'T READ."**<br>
> If an incoming notice cannot be parsed or fails schema validation, the API returns an HTTP 4xx error and the x402 payment authorization is cancelled immediately without settlement.

---

## Example

### Input (POST `/parse`)
```json
{
  "notice": "Train 12137 at NGP expected 14:35 due to signal failure"
}
```

### Output (HTTP 200 OK)
```json
{
  "train": "12137",
  "station": "NGP",
  "expectedTime": "14:35",
  "reason": "signal failure"
}
```

---

## Features

- **Railway Delay Parser**: Robust regex extraction handling variable train prefixes (`Train 12137` or `12137`), optional `at` markers, 3–4 letter uppercase station codes, 24-hour `HH:MM` times, and optional reasons (including multilingual UTF-8 text like Hindi).
- **Zod Schema Validation**: Strict runtime schema enforcement ensuring numeric trains, valid uppercase station codes, and 24-hour time formats.
- **Malformed Input Handling**: Gracefully rejects missing fields or garbage text with HTTP 400 Bad Request.
- **Dual-Layer Input Size Protection**: 100kb Express payload limit plus a 2,000-character notice length cap (returns HTTP 413 Payload Too Large).
- **x402 Payment Gating**: Route-level payment enforcement utilizing `@x402/express`, `@x402/core`, and `@x402/evm`.
- **Base Sepolia Testnet**: Testnet-only configuration locked strictly to `eip155:84532`.
- **Test USDC Asset**: Integrated with official Base Sepolia test USDC (`0x036CbD53842c5426634e7929541eC2318f3dCF7e`).
- **Tiered Pricing**: Differentiated server-side pricing for single (`$0.001`) vs. bulk (`$0.005`) parsing.
- **Autonomous Buyer Client**: Fully functional buyer script demonstrating 402 challenge negotiation, EIP-712 payment signing, and automatic retry.
- **Automated Test Suite**: 29 automated unit and integration tests covering free routes, parsing edge cases, x402 payment settlement lifecycle, and buyer flows.

---

## Architecture & Request Lifecycle

```text
 Client
   │
   ▼
 Express HTTP Server
   │
   ▼
 x402 Middleware (@x402/express)
   ├─► No Payment Header ─────────────► Returns HTTP 402 (PAYMENT-REQUIRED header)
   └─► Valid Payment Signature ───────► Verifies with Facilitator & Proceeds
         │
         ▼
 Parser (Regex Extraction)
         │
         ▼
 Zod Validation (delayNoticeSchema)
         │
         ├─► Success (200 OK) ────────► Returns Parsed JSON ──► x402 Settles Payment
         │
         └─► Failure (4xx Error) ─────► Returns Error JSON ───► x402 Cancels Payment (NO SETTLEMENT)
```

### Settlement Protection Invariant
When a client submits an x402 payment signature:
1. The facilitator verifies the signature against server payment requirements.
2. The route handler executes the regex parser and Zod schema validator.
3. If parsing succeeds, Express returns `200 OK`, prompting the middleware to complete settlement with the facilitator.
4. If parsing fails (`400 Bad Request`) or the notice is oversized (`413 Payload Too Large`), the middleware intercepts the response status code and calls `cancellationDispatcher.cancel(...)`.
5. **No payment is captured for invalid notices.**

---

## API Endpoints

### 1. `GET /health` (FREE)
Public service health check.

- **Payment:** None required.
- **Response:** `200 OK`
```json
{
  "status": "ok",
  "service": "railway-delay-api"
}
```

### 2. `GET /` (FREE)
Root service status check.

- **Payment:** None required.
- **Response:** `200 OK` (`"Railway Delay API is running"`)

### 3. `POST /parse` (PAID — $0.001 USDC)
Parses a single railway delay notice.

- **Payment:** Requires x402 payment authorization for `$0.001` USDC on Base Sepolia (`eip155:84532`).
- **Headers:**
  - `Content-Type: application/json`
  - `payment-signature: <base64-encoded-x402-v2-payload>`
- **Request Body:**
```json
{
  "notice": "12137 at NGP expected 14:35 due to signal failure"
}
```
- **Response:** `200 OK`
```json
{
  "train": "12137",
  "station": "NGP",
  "expectedTime": "14:35",
  "reason": "signal failure"
}
```
- **Error Response (Malformed Notice):** `400 Bad Request` (Payment is cancelled)
```json
{
  "error": "Unable to parse notice: missing train, station, or expected time"
}
```

### 4. `POST /parse/bulk` (PAID — $0.005 USDC)
Parses an array of up to 20 railway delay notices in a single batch.

- **Payment:** Requires x402 payment authorization for `$0.005` USDC on Base Sepolia (`eip155:84532`).
- **Request Body:**
```json
{
  "notices": [
    "12137 at NGP expected 14:35 due to signal failure",
    "11010 at PUNE expected 16:20 due to track maintenance"
  ]
}
```
- **Response:** `200 OK`
```json
{
  "results": [
    {
      "train": "12137",
      "station": "NGP",
      "expectedTime": "14:35",
      "reason": "signal failure"
    },
    {
      "train": "11010",
      "station": "PUNE",
      "expectedTime": "16:20",
      "reason": "track maintenance"
    }
  ]
}
```
- **Error Response:** If any notice in the batch is invalid, returns `400 Bad Request` and no payment is settled.

---

## Payment & x402 Integration

The service implements the x402 v2 protocol using the official packages:
- `@x402/core` (`^2.27.0`)
- `@x402/express` (`^2.27.0`)
- `@x402/evm` (`^2.27.0`)

### Specifications
- **Network:** Base Sepolia testnet (`eip155:84532`). Mainnet configurations are rejected at startup.
- **Scheme:** `exact` EVM authorization scheme.
- **Asset:** Official Base Sepolia test USDC contract address (`0x036CbD53842c5426634e7929541eC2318f3dCF7e`).
- **Facilitator:** Configurable facilitator client (defaults to `https://x402.org/facilitator`).
- **Server-Controlled Price:** Prices are strictly hardcoded in server route declarations (`$0.001` for single, `$0.005` for bulk) or configured via server environment variables. Request body or query overrides (e.g. `{ "price": "$0.000001" }`) are completely ignored.
- **Server-Controlled payTo:** Payee wallet address is set strictly server-side through `X402_PAY_TO`. Client-supplied payTo parameters are ignored.

*Note: This implementation is designed exclusively for the Base Sepolia testnet and does not claim production mainnet support.*

---

## Environment Variables

Configure application settings by copying `.env.example` to `.env`:

```bash
cp .env.example .env
```

| Variable | Description | Example / Default |
|----------|-------------|-------------------|
| `PORT` | Server listening port | `3000` |
| `NODE_ENV` | Runtime environment | `development` |
| `X402_NETWORK` | Target blockchain network (must be Base Sepolia) | `eip155:84532` |
| `X402_FACILITATOR_URL` | x402 facilitator endpoint URL | `https://x402.org/facilitator` |
| `X402_PAY_TO` | Server recipient wallet address (EVM 0x format) | `0xYOUR_TESTNET_WALLET_ADDRESS` |
| `X402_PARSE_PRICE` | Fixed price for single notice parse route | `$0.001` |
| `X402_BULK_PRICE` | Fixed price for bulk notices parse route | `$0.005` |
| `BUYER_PRIVATE_KEY` | Private key for buyer client (local testnet only) | `0xYOUR_BUYER_PRIVATE_KEY_HERE` |
| `API_URL` | Target API URL for buyer client | `http://localhost:3000` |

*Security Rule: Never commit real private keys or `.env` files to version control.*

---

## Installation

Ensure Node.js (v20+) and npm are installed, then install project dependencies:

```bash
npm install
```

---

## Development & Available Scripts

The following commands are defined in `package.json`:

```bash
# Start development server with ts-node
npm run dev

# Compile TypeScript to JavaScript in dist/
npm run build

# Start the compiled production server
npm start

# Run automated test suite with Vitest
npm test

# Run tests in interactive watch mode
npm run test:watch

# Execute the buyer client script
npm run buyer
```

---

## Buyer Client Setup

The repository includes a standalone buyer client in `src/client/buyer.ts` that executes an autonomous x402 purchase flow against the API:

1. Sends an initial unpaid request to `/parse`.
2. Intercepts the `402 Payment Required` response and extracts server payment parameters.
3. Constructs and signs an EIP-712 transfer authorization using `@x402/evm/exact/client`.
4. Resubmits the request with the base64-encoded `PAYMENT-SIGNATURE` header.
5. Returns the parsed JSON notice.

### Running the Buyer
To test the buyer against a local server:
1. In one terminal, start the API:
   ```bash
   npm run dev
   ```
2. In a second terminal, execute the buyer:
   ```bash
   npm run buyer
   ```

*Note: If `BUYER_PRIVATE_KEY` is omitted, the buyer dynamically generates an ephemeral key for local/offline testing.*

---

## Testnet Funding Requirements

To execute a real on-chain transaction through the x402 facilitator against the live Base Sepolia testnet:
- The buyer wallet configured in `BUYER_PRIVATE_KEY` must hold test **USDC** on the **Base Sepolia** network.
- The server recipient wallet (`X402_PAY_TO`) must be a valid EVM address on Base Sepolia.

---

## Security

- **Credential Isolation:** All credentials and wallet keys are managed exclusively via environment variables. `.env` is ignored by `.gitignore`.
- **Price Tamper Resistance:** Route prices are configured server-side. Client payload parameters cannot alter or reduce the payment amount.
- **payTo Tamper Resistance:** The recipient address is enforced by server configuration; client override attempts are ignored.
- **Network Locking:** `X402Config.validate()` explicitly enforces `eip155:84532`, preventing accidental execution against Ethereum or Base mainnets.
- **Input Boundaries:**
  - Express JSON body parser enforces a `100kb` upper limit.
  - Notice length is strictly capped at `2,000` characters.
  - Bulk notice arrays are restricted to a maximum of `20` items.
- **Settlement Protection:** Any parsing error or schema validation failure immediately returns HTTP 4xx, halting and cancelling the payment authorization before settlement can occur.

---

## Testing

Run the full automated test suite:

```bash
npm test
```

### Verified Test Status
- **Current Test Count:** **29 passing tests across 4 suites** (0 failures).
- **Test Suites:**
  - `tests/health.test.ts`: Free route health checks.
  - `tests/parse.test.ts`: Notice regex parsing, multilingual support, Zod schema validation, and malformed notice rejection.
  - `tests/x402.test.ts`: x402 middleware gating, tiered pricing, tamper resistance, and settlement cancellation on 4xx.
  - `tests/buyer.test.ts`: Buyer client discovery, signing, retry loop, and error handling.

---

## Project Structure

```text
railway-delay-api/
├── .env.example              # Environment variables template with sanitized placeholders
├── .gitignore                # Git ignore rules (ignoring .env, node_modules, dist)
├── package.json              # Project dependencies and script definitions
├── package-lock.json         # Dependency lockfile
├── README.md                 # Project documentation and architectural guide
├── tsconfig.json             # TypeScript compiler configuration (Node16 module resolution)
├── vitest.config.ts          # Vitest testing configuration
├── samples/
│   ├── malformed/            # Sample invalid notices for testing
│   │   ├── garbage.txt
│   │   ├── missing-station.txt
│   │   ├── missing-time.txt
│   │   └── missing-train.txt
│   └── valid/                # Sample valid notices for testing
│       ├── notice-01.txt
│       ├── notice-02.txt
│       ├── notice-03.txt
│       └── notice-hindi.txt
├── src/
│   ├── app.ts                # Express application setup, routes, and x402 middleware mounting
│   ├── server.ts             # HTTP server entry point listening on PORT
│   ├── client/
│   │   └── buyer.ts          # Autonomous x402 buyer client implementation
│   ├── parser/
│   │   ├── delayParser.ts    # Regex parsing logic and Zod validation wrapper
│   │   └── delaySchema.ts    # Zod schema definitions (delayNoticeSchema, DelayNotice type)
│   ├── payment/
│   │   └── x402.ts           # x402 server configuration and network validator
│   └── routes/
│       ├── bulk.ts           # Bulk delay notice parsing route handler (POST /parse/bulk)
│       ├── health.ts         # Free health check route handler (GET /health)
│       └── parse.ts          # Single delay notice parsing route handler (POST /parse)
└── tests/
    ├── buyer.test.ts         # Buyer client integration tests
    ├── health.test.ts        # Health check tests
    ├── parse.test.ts         # Parser unit tests and malformed input handling
    └── x402.test.ts          # x402 middleware gating and settlement lifecycle tests
```

---

## Limitations & Project Status

- **Testnet Only:** Configured and validated exclusively for the Base Sepolia testnet (`eip155:84532`). Mainnet is not supported.
- **Simulated Test Harness:** Real funded-wallet blockchain settlement has not been executed as part of this development session; x402 settlement behavior is validated using automated mock facilitator test harnesses against the official `@x402` packages.
- **Demonstration Scope:** This project is developed as a hackathon/challenge implementation showcasing x402 micro-monetization patterns, not a production railway dispatch system.