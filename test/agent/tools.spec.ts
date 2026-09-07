import { createSearchKnowledgeTool } from '../../src/modules/agent/graph/tools/search-knowledge.tool';
import {
  createEscalateToHumanTool,
  DEFAULT_HOLDING_MESSAGE,
} from '../../src/modules/agent/graph/tools/escalate-to-human.tool';
import { KnowledgeBaseService } from '../../src/modules/knowledge-base/knowledge-base.service';
import { EmbeddingService } from '../../common/embedding/embedding.service';
import { TenantTransaction } from '../../common/tenant-context/tenant-transaction';

describe('Agent Tools', () => {
  describe('search_knowledge tool', () => {
    let mockKbService: { searchTopChunk: jest.Mock };
    let mockEmbeddingService: { embed: jest.Mock };
    let mockTenantTransaction: { run: jest.Mock };
    let searchTool: ReturnType<typeof createSearchKnowledgeTool>;

    beforeEach(() => {
      mockKbService = { searchTopChunk: jest.fn() };
      mockEmbeddingService = {
        embed: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
      };
      mockTenantTransaction = {
        run: jest.fn(async (_tenantId: string, fn: (tx?: any) => Promise<any>) =>
          fn({}),
        ),
      };

      searchTool = createSearchKnowledgeTool(
        mockKbService as unknown as KnowledgeBaseService,
        mockEmbeddingService as unknown as EmbeddingService,
        mockTenantTransaction as unknown as TenantTransaction,
      );
    });

    it('returns chunk when distance <= 0.5', async () => {
      mockKbService.searchTopChunk.mockResolvedValue({
        content: 'Root canal treatment costs 15000 DZD',
        distance: 0.25,
      });

      const result = await searchTool.invoke(
        { query: 'root canal price' },
        { configurable: { tenantId: 'tenant-1' } },
      );

      const parsed = JSON.parse(result);
      expect(parsed.found).toBe(true);
      expect(parsed.content).toContain('15000 DZD');
      expect(parsed.distance).toBe(0.25);
    });

    it('returns found: false when chunk distance > 0.5 (cutoff exceeded)', async () => {
      mockKbService.searchTopChunk.mockResolvedValue({
        content: 'Irrelevant cleaning info',
        distance: 0.65,
      });

      const result = await searchTool.invoke(
        { query: 'car repairs' },
        { configurable: { tenantId: 'tenant-1' } },
      );

      const parsed = JSON.parse(result);
      expect(parsed.found).toBe(false);
      expect(parsed.message).toContain('No relevant information found');
    });

    it('returns found: false when no chunk found at all', async () => {
      mockKbService.searchTopChunk.mockResolvedValue(null);

      const result = await searchTool.invoke(
        { query: 'unknown query' },
        { configurable: { tenantId: 'tenant-1' } },
      );

      const parsed = JSON.parse(result);
      expect(parsed.found).toBe(false);
      expect(parsed.message).toContain('No relevant information found');
    });

    it('throws when tenant context is missing', async () => {
      await expect(
        searchTool.invoke({ query: 'hello' }, { configurable: {} }),
      ).rejects.toThrow('Tenant context missing');
    });
  });

  describe('escalate_to_human tool', () => {
    const escalateTool = createEscalateToHumanTool();

    it('returns escalation payload with default holding message', async () => {
      const result = await escalateTool.invoke({
        reason: 'Knowledge base does not have zygomatic implant information',
      });

      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('escalated');
      expect(parsed.reason).toBe(
        'Knowledge base does not have zygomatic implant information',
      );
      expect(parsed.message).toBe(DEFAULT_HOLDING_MESSAGE);
    });

    it('returns escalation payload with custom holding message if provided', async () => {
      const customMsg =
        'Please wait a moment while I connect you with Dr. Sarah.';
      const result = await escalateTool.invoke({
        reason: 'Patient specifically requested human',
        holdingMessage: customMsg,
      });

      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('escalated');
      expect(parsed.reason).toBe('Patient specifically requested human');
      expect(parsed.message).toBe(customMsg);
    });
  });
});
