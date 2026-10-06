import { PayPalMCPToolkit, type Tool as ToolkitTool } from "@paypal/agent-toolkit/mcp";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { z } from "zod";
import { SANDBOX_BASE_URL, SandboxGuardError } from "./config";
import { customDisputeTools } from "./disputes";

/**
 * PayPal Agent Toolkit wrapper.
 * SAFETY: the toolkit defaults to LIVE (`context.sandbox` false → api-m.paypal.com).
 * We always pass sandbox: true and assert the resulting base URL.
 */
export const TOOLKIT_ACTIONS = {
  disputes: { list: true, get: true, create: true },
  shipment: { create: true, get: true },
  transactions: { list: true },
  orders: { get: true },
} as const;

export function createSandboxToolkit(accessToken: string) {
  const toolkit = new PayPalMCPToolkit({
    accessToken,
    configuration: { actions: TOOLKIT_ACTIONS as never, context: { sandbox: true } },
  });
  const api = toolkit.getPaypalAPIService();
  if (api.baseUrl !== SANDBOX_BASE_URL) {
    throw new SandboxGuardError(`Agent Toolkit resolved to ${api.baseUrl}; refusing to run outside sandbox`);
  }
  return {
    tools: toolkit.getTools(),
    /** Run a toolkit method (e.g. "get_dispute"); returns the toolkit's JSON string. */
    run: (method: string, args: unknown) => api.run(method, args),
    baseUrl: api.baseUrl,
  };
}

export interface ClaudeToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** zod schema → Claude tool input_schema (draft-07, no $schema/$ref). */
export function zodToClaudeSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const json = zodToJsonSchema(schema, { target: "jsonSchema7", $refStrategy: "none" }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

export function toolkitToolToClaude(tool: Pick<ToolkitTool, "method" | "description" | "parameters">): ClaudeToolDefinition {
  return { name: tool.method, description: tool.description.trim(), input_schema: zodToClaudeSchema(tool.parameters) };
}

/** Our custom dispute tools as Claude tools (binary `files` are attached by the server, not the model). */
export function customToolsToClaude(): ClaudeToolDefinition[] {
  return Object.values(customDisputeTools).map((t) => {
    const params = t.parameters as z.AnyZodObject;
    const schema = "files" in params.shape ? params.omit({ files: true }) : params;
    return { name: t.method, description: t.description, input_schema: zodToClaudeSchema(schema) };
  });
}
