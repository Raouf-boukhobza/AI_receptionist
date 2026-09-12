export class WhatsappSendError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable: boolean,
    message: string,
    public readonly status?: number,
    public readonly fbtraceId?: string,
  ) {
    super(message);
    this.name = 'WhatsappSendError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
