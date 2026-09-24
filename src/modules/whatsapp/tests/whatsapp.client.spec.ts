import { WhatsappClient } from '../whatsapp.client';
import { WhatsappSendError } from '../whatsapp.errors';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

describe('WhatsappClient', () => {
  let client: WhatsappClient;
  let mockPrismaService: any;
  let mockConfigService: any;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    mockPrismaService = {
      rawClient: {
        tenants: {
          findUnique: jest.fn(),
        },
      },
    };

    mockConfigService = {
      get: jest.fn().mockImplementation((key: string, defaultValue?: string) => {
        if (key === 'META_GRAPH_VERSION') return 'v21.0';
        return defaultValue;
      }),
    };

    client = new WhatsappClient(
      mockPrismaService as unknown as PrismaService,
      mockConfigService as unknown as ConfigService,
    );

    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('throws NO_CREDENTIALS when tenant does not exist or credentials missing', async () => {
    mockPrismaService.rawClient.tenants.findUnique.mockResolvedValue(null);

    await expect(
      client.sendText({ tenantId: 'tenant-1', to: '+1234567890', body: 'Hello' }),
    ).rejects.toThrow(WhatsappSendError);

    mockPrismaService.rawClient.tenants.findUnique.mockResolvedValue({
      phone_number_id: 'pn-1',
      access_token: null,
    });

    await expect(
      client.sendText({ tenantId: 'tenant-1', to: '+1234567890', body: 'Hello' }),
    ).rejects.toThrow('missing WhatsApp credentials');
  });

  it('successfully sends message and returns wamid', async () => {
    mockPrismaService.rawClient.tenants.findUnique.mockResolvedValue({
      phone_number_id: 'pn-12345',
      access_token: 'secret-token-123',
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        messages: [{ id: 'wamid.test.123' }],
      }),
    } as any);

    const result = await client.sendText({
      tenantId: 'tenant-1',
      to: '+1234567890',
      body: 'Hello client',
    });

    expect(result).toEqual({ wamid: 'wamid.test.123' });
    expect(global.fetch).toHaveBeenCalledWith(
      'https://graph.facebook.com/v21.0/pn-12345/messages',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer secret-token-123',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: '1234567890',
          type: 'text',
          text: { body: 'Hello client' },
        }),
      }),
    );
  });

  it('handles 5xx server errors as retryable', async () => {
    mockPrismaService.rawClient.tenants.findUnique.mockResolvedValue({
      phone_number_id: 'pn-12345',
      access_token: 'secret-token',
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: jest.fn().mockResolvedValue({
        error: { message: 'Service Unavailable', code: 2 },
      }),
    } as any);

    try {
      await client.sendText({ tenantId: 'tenant-1', to: '+1234567890', body: 'Hello' });
      fail('Should have thrown');
    } catch (err: any) {
      expect(err).toBeInstanceOf(WhatsappSendError);
      expect(err.retryable).toBe(true);
      expect(err.status).toBe(503);
    }
  });

  it('handles rate limits (Meta code 130429, 80007, 4) as retryable', async () => {
    mockPrismaService.rawClient.tenants.findUnique.mockResolvedValue({
      phone_number_id: 'pn-12345',
      access_token: 'secret-token',
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: jest.fn().mockResolvedValue({
        error: { message: 'Rate limit hit', code: 130429, fbtrace_id: 'fb-trace-1' },
      }),
    } as any);

    try {
      await client.sendText({ tenantId: 'tenant-1', to: '+1234567890', body: 'Hello' });
      fail('Should have thrown');
    } catch (err: any) {
      expect(err).toBeInstanceOf(WhatsappSendError);
      expect(err.retryable).toBe(true);
      expect(err.fbtraceId).toBe('fb-trace-1');
    }
  });

  it('handles token invalid (code 190) as non-retryable', async () => {
    mockPrismaService.rawClient.tenants.findUnique.mockResolvedValue({
      phone_number_id: 'pn-12345',
      access_token: 'invalid-token',
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: jest.fn().mockResolvedValue({
        error: { message: 'Invalid OAuth access token', code: 190 },
      }),
    } as any);

    try {
      await client.sendText({ tenantId: 'tenant-1', to: '+1234567890', body: 'Hello' });
      fail('Should have thrown');
    } catch (err: any) {
      expect(err).toBeInstanceOf(WhatsappSendError);
      expect(err.retryable).toBe(false);
    }
  });

  it('handles 24h window closed (code 131047) as non-retryable', async () => {
    mockPrismaService.rawClient.tenants.findUnique.mockResolvedValue({
      phone_number_id: 'pn-12345',
      access_token: 'token',
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: jest.fn().mockResolvedValue({
        error: { message: 'Re-engagement message needed', code: 131047 },
      }),
    } as any);

    try {
      await client.sendText({ tenantId: 'tenant-1', to: '+1234567890', body: 'Hello' });
      fail('Should have thrown');
    } catch (err: any) {
      expect(err).toBeInstanceOf(WhatsappSendError);
      expect(err.retryable).toBe(false);
    }
  });

  it('handles invalid recipient (code 131026) as non-retryable', async () => {
    mockPrismaService.rawClient.tenants.findUnique.mockResolvedValue({
      phone_number_id: 'pn-12345',
      access_token: 'token',
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: jest.fn().mockResolvedValue({
        error: { message: 'Receiver is incapable of receiving this message', code: 131026 },
      }),
    } as any);

    try {
      await client.sendText({ tenantId: 'tenant-1', to: '+1234567890', body: 'Hello' });
      fail('Should have thrown');
    } catch (err: any) {
      expect(err).toBeInstanceOf(WhatsappSendError);
      expect(err.retryable).toBe(false);
    }
  });

  it('handles abort/timeout as retryable TIMEOUT error', async () => {
    mockPrismaService.rawClient.tenants.findUnique.mockResolvedValue({
      phone_number_id: 'pn-12345',
      access_token: 'token',
    });

    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    global.fetch = jest.fn().mockRejectedValue(abortError);

    try {
      await client.sendText({ tenantId: 'tenant-1', to: '+1234567890', body: 'Hello' });
      fail('Should have thrown');
    } catch (err: any) {
      expect(err).toBeInstanceOf(WhatsappSendError);
      expect(err.code).toBe('TIMEOUT');
      expect(err.retryable).toBe(true);
    }
  });

  it('handles generic network errors as retryable NETWORK_ERROR', async () => {
    mockPrismaService.rawClient.tenants.findUnique.mockResolvedValue({
      phone_number_id: 'pn-12345',
      access_token: 'token',
    });

    global.fetch = jest.fn().mockRejectedValue(new Error('fetch failed'));

    try {
      await client.sendText({ tenantId: 'tenant-1', to: '+1234567890', body: 'Hello' });
      fail('Should have thrown');
    } catch (err: any) {
      expect(err).toBeInstanceOf(WhatsappSendError);
      expect(err.code).toBe('NETWORK_ERROR');
      expect(err.retryable).toBe(true);
    }
  });

  it('sends templates with name, language and body params', async () => {
    mockPrismaService.rawClient.tenants.findUnique.mockResolvedValue({
      phone_number_id: 'pn-12345',
      access_token: 'secret-token',
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        messages: [{ id: 'wamid.tpl.1' }],
      }),
    } as any);

    const result = await client.sendTemplate({
      tenantId: 'tenant-1',
      to: '+1234567890',
      templateName: 'appointment_reminder',
      languageCode: 'en',
      bodyParams: ['Dental cleaning', '2026-09-23', '10:00'],
    });

    expect(result).toEqual({ wamid: 'wamid.tpl.1' });
    expect(global.fetch).toHaveBeenCalledWith(
      'https://graph.facebook.com/v21.0/pn-12345/messages',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: '1234567890',
          type: 'template',
          template: {
            name: 'appointment_reminder',
            language: { code: 'en' },
            components: [
              {
                type: 'body',
                parameters: [
                  { type: 'text', text: 'Dental cleaning' },
                  { type: 'text', text: '2026-09-23' },
                  { type: 'text', text: '10:00' },
                ],
              },
            ],
          },
        }),
      }),
    );
  });

  it('handles template config errors (132xxx) as non-retryable', async () => {
    mockPrismaService.rawClient.tenants.findUnique.mockResolvedValue({
      phone_number_id: 'pn-12345',
      access_token: 'token',
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: jest.fn().mockResolvedValue({
        error: { message: 'Template does not exist', code: 132000 },
      }),
    } as any);

    try {
      await client.sendTemplate({
        tenantId: 'tenant-1',
        to: '+1234567890',
        templateName: 'nope',
        bodyParams: [],
      });
      fail('Should have thrown');
    } catch (err: any) {
      expect(err).toBeInstanceOf(WhatsappSendError);
      expect(err.retryable).toBe(false);
    }
  });
});
