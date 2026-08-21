import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { KnowledgeBaseService } from '../../../knowledge-base/knowledge-base.service';
import { EmbeddingService } from '../../../../../common/embedding/embedding.service';
import {TenantTransaction} from "../../../../../common/tenant-context/tenant-transaction";

const searchKnowledgeSchema = z.object({
  query: z
    .string()
    .describe(
      'The question or topic to search for in the clinic knowledge base',
    ),
});

export function createSearchKnowledgeTool(
  knowledgeBaseService: KnowledgeBaseService,
  embeddingService: EmbeddingService,
  tenantTransaction : TenantTransaction,
) {
  return tool(
    async ({ query }, config) => {
      const tenantId = config.configurable?.tenantId;
      if (!tenantId) {
        throw new Error('Tenant context missing from tool execution');
      }

      const vector = await embeddingService.embed(query);

      const topChunk = await tenantTransaction.run(tenantId, async () => {
        return knowledgeBaseService.searchTopChunk(tenantId, vector);
      });

      if (!topChunk) {
        return JSON.stringify({
          message: 'No relevant information found in knowledge base.',
        });
      }

      return JSON.stringify(topChunk);
    },
    {
      name: 'search_knowledge',
      description:
        "Search the clinic's knowledge base for information about services, prices, hours, or FAQs.",
      schema: searchKnowledgeSchema,
    },
  );
}
