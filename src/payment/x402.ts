/**
 * Payment configuration for x402 middleware.
 * All values must be set server-side via environment variables.
 */
export class X402Config {
  public static get NETWORK(): string {
    return process.env.X402_NETWORK ?? 'eip155:84532';
  }
  public static get FACILITATOR_URL(): string {
    return process.env.X402_FACILITATOR_URL ?? 'https://x402.org/facilitator';
  }
  public static get PAY_TO(): string {
    return process.env.X402_PAY_TO ?? '';
  }
  public static get PARSE_PRICE(): string {
    return process.env.X402_PARSE_PRICE ?? '$0.001';
  }
  public static get BULK_PRICE(): string {
    return process.env.X402_BULK_PRICE ?? '$0.005';
  }

  /**
   * Validate the configuration.
   * Throws an error if required values are missing or invalid.
   */
  public static validate(): void {
    // Validate payTo address
    if (!this.PAY_TO) {
      throw new Error('X402_PAY_TO environment variable is required');
    }
    const evmAddressRegex = /^0x[a-fA-F0-9]{40}$/;
    if (!evmAddressRegex.test(this.PAY_TO)) {
      throw new Error('X402_PAY_TO must be a valid EVM address (0x followed by 40 hex characters)');
    }

    // Validate price format (optional: could be more strict)
    const priceRegex = /^\$\d+(\.\d+)?$/;
    if (!priceRegex.test(this.PARSE_PRICE)) {
      throw new Error('X402_PARSE_PRICE must be in format like "$0.001"');
    }
    if (!priceRegex.test(this.BULK_PRICE)) {
      throw new Error('X402_BULK_PRICE must be in format like "$0.005"');
    }

    // Ensure network is supported (we only support Base Sepolia for now)
    if (this.NETWORK !== 'eip155:84532') {
      throw new Error('Only Base Sepolia (eip155:84532) is supported');
    }
  }
}