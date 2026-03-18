import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, ToolInputError, readStringParam, readNumberParam } from "./common.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";

const log = createSubsystemLogger("kb-search");

const KBSearchToolSchema = Type.Object({
  query: Type.String({
    minLength: 2,
    description: "Search query for the knowledge base (minimum 2 characters)",
  }),
  limit: Type.Optional(
    Type.Number({
      minimum: 1,
      maximum: 20,
      description: "Maximum results to return (default 8)",
    }),
  ),
});

type KBSearchResult = {
  chunk_id: string;
  document_id: number;
  score: number;
  text: string;
  sourceRef: string;
  title: string;
  version: string;
};

type KBSearchResponse = {
  tenant_id: number;
  query: string;
  results: KBSearchResult[];
};

export function createKBSearchTool(opts?: {
  agentSessionKey?: string;
  /** Backend API URL (defaults to http://pleiades-backend:8000) */
  backendUrl?: string;
  /** Tenant ID for KB searches - REQUIRED */
  tenantId?: number;
}): AnyAgentTool {
  return {
    label: "Knowledge Base",
    name: "kb_search",
    description:
      "Search the tenant's knowledge base for relevant information. Always search KB first before answering questions to provide accurate, cited information.",
    parameters: KBSearchToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const query = readStringParam(params, "query", { required: true });
      const limitParam = readNumberParam(params, "limit", { integer: true });
      const limit = limitParam || 8;

      if (limit < 1 || limit > 20) {
        throw new ToolInputError("limit must be between 1 and 20");
      }

      // Get tenant ID
      const tenantId = opts?.tenantId;
      if (!tenantId || tenantId <= 0) {
        throw new ToolInputError("Tenant ID not configured. Cannot search knowledge base.");
      }

      const backendUrl = opts?.backendUrl || "http://pleiades-backend:8000";
      const rpcUrl = `${backendUrl}/api/kb/rpc/search`;
      const params_url = new URLSearchParams({
        tenant_id: String(tenantId),
        q: query,
        limit: String(limit),
      });

      try {
        log.debug(`kb_search: query="${query}" tenant_id=${tenantId} limit=${limit}`);

        const response = await fetch(`${rpcUrl}?${params_url.toString()}`, {
          method: "GET",
          signal: AbortSignal.timeout(30_000), // 30 second timeout
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => "");
          log.warn(
            `kb_search failed: ${response.status} ${response.statusText} - ${errorText}`,
          );
          throw new Error(
            `KB search failed (${response.status}): ${response.statusText}`,
          );
        }

        const data = (await response.json()) as KBSearchResponse;

        // Format results for agent consumption
        const formatted = data.results.map((r) => ({
          source: r.sourceRef,
          title: r.title,
          relevance_score: Math.round(r.score * 100) / 100,
          text: r.text.length > 500 ? r.text.substring(0, 500) + "..." : r.text,
          version: r.version,
        }));

        if (formatted.length > 0) {
          log.info(
            `kb_search: query="${query}" tenant_id=${tenantId} results=${formatted.length}`,
          );
        }

        return jsonResult({
          ok: true,
          query,
          results_count: formatted.length,
          results: formatted,
          message:
            formatted.length > 0
              ? `Found ${formatted.length} relevant result${formatted.length === 1 ? "" : "s"}. Remember to cite your sources!`
              : "No results found in knowledge base for this query.",
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error(`kb_search error: ${message}`, { query, tenantId });
        return jsonResult({
          ok: false,
          query,
          results_count: 0,
          results: [],
          error: `Knowledge base search failed: ${message}`,
          message:
            "Could not search the knowledge base. Please try again or rephrase your question.",
        });
      }
    },
  };
}
