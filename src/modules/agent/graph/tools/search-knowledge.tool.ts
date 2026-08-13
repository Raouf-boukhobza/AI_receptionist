import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { KnowledgeBaseService } from '../../../knowledge-base/knowledge-base.service';
import { EmbeddingService } from '../../../../../common/embedding/embedding.service';

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
) {
  return tool(
    async ({ query }, config) => {
      const tenantId = config.configurable?.tenantId;
      const vector = await embeddingService.embed(query);
      return knowledgeBaseService.searchTopChunk(tenantId, vector);
    },
    {
      name: 'search_knowledge',
      description:
        "Search the clinic's knowledge base for information about services, prices, hours, or FAQs.",
      schema: searchKnowledgeSchema,
    },
  );
}
