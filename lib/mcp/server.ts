import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PayPalClient } from "../paypal/client";
import { customDisputeTools, getDispute, runCustomDisputeTool, type CustomToolName } from "../paypal/disputes";
import { availableActions } from "../paypal/links";
import { redactObject } from "../redact";
import { scrub } from "../log/scrub";
import { assessDispute, type AssessDeps } from "./assess";
import type { ReplayPayPalClient } from "./replay";

/**
 * Our PayPal Agent Toolkit extension as an MCP server (works in Claude Desktop or any MCP client).
 * - read tools: list_disputes, get_dispute (redacted, with the actions PayPal allows now)
 * - write tools: the 7 custom dispute tools the toolkit doesn't ship (evidence, supporting info, offer,
 *   message, escalate, acknowledge return, accept claim). Off unless allowWrites; always sandbox-only and
 *   HATEOAS-gated (runCustomDisputeTool re-reads the dispute before writing).
 * - assess_dispute: the agent's own verdict on a case, from the fixed rules (no AI, no writes).
 * - replay: the client is a ReplayPayPalClient (fixtures, no keys). Write tools then return the
 *   would-be request and never send it.
 */
type Client = Pick<PayPalClient, "request">;

/** The PayPal Agent Toolkit's tools (from createSandboxToolkit) and a runner for them. */
export interface ToolkitLike {
  tools: { method: string; name?: string; description: string; parameters: z.ZodTypeAny }[];
  run: (method: string, args: unknown) => Promise<string>;
}

/** Toolkit tools we serve: read-only. Its write tools (dispute create, accept claim, create tracking) are not exposed. */
export const TOOLKIT_READ_TOOLS = ["list_disputes", "get_dispute", "get_order", "get_shipment_tracking", "list_transactions"] as const;

const parseMaybe = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
};

const text = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
const fail = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });

export interface McpOptions {
  allowWrites: boolean;
  toolkit?: ToolkitLike;
  /** Enables assess_dispute: the gateway, carrier and store the agent reads. */
  assess?: AssessDeps;
  /** Replay mode: `client` is a ReplayPayPalClient; writes are captured, never sent. */
  replay?: ReplayPayPalClient;
}

export function buildMcpServer(client: Client, opts: McpOptions): McpServer {
  const server = new McpServer({ name: opts.replay ? "dispute-defender-replay" : "dispute-defender-paypal", version: "0.1.0" });

  if (opts.toolkit) {
    // PayPal Agent Toolkit tools, sandbox-forced by createSandboxToolkit; outputs redacted.
    for (const t of opts.toolkit.tools.filter((x) => (TOOLKIT_READ_TOOLS as readonly string[]).includes(x.method))) {
      server.registerTool(
        t.method,
        { title: `${t.name ?? t.method} (PayPal Agent Toolkit)`, description: t.description.trim(), inputSchema: (t.parameters as z.AnyZodObject).shape, annotations: { readOnlyHint: true } },
        async (args: Record<string, unknown>) => {
          const out = redactObject(parseMaybe(await opts.toolkit!.run(t.method, args)));
          if (t.method === "get_dispute" && out && typeof out === "object") return text({ allowed_actions: availableActions(out as { links?: { rel: string }[] }), dispute: out });
          return text(out);
        },
      );
    }
  } else registerOwnReadTools(server, client);

  if (opts.assess) registerAssessTool(server, opts.assess);
  registerCustomTools(server, client, opts);
  return server;
}

function registerAssessTool(server: McpServer, deps: AssessDeps) {
  server.registerTool(
    "assess_dispute",
    {
      title: "The agent's verdict on a dispute (fixed rules, no AI)",
      description:
        "Gathers the dispute, order, PayPal tracking, carrier scans and store logs, then returns Dispute Defender's verdict (Defend / Offer / Refund / Hold / Wait) with the evidence strength, each reason and its source record, the actions PayPal allows right now with why each was or wasn't picked, and the cost to fight. Deterministic rules, no AI call, no writes. Use it as a second opinion before calling a write tool: it says when the seller should refund instead of fighting.",
      inputSchema: { dispute_id: z.string().regex(/^PP-[A-Z0-9-]{3,40}$/) },
      annotations: { readOnlyHint: true },
    },
    async ({ dispute_id }) => {
      try {
        const out = await assessDispute(dispute_id, deps);
        return out ? text(out) : fail(`Dispute ${dispute_id} not found.`);
      } catch (e) {
        return fail(scrub(e instanceof Error ? e.message : "Assessment failed"));
      }
    },
  );
}

function registerOwnReadTools(server: McpServer, client: Client) {
  server.registerTool(
    "list_disputes",
    { title: "List PayPal disputes", description: "List the seller's PayPal (sandbox) disputes with status, reason and amount.", inputSchema: { status: z.string().optional() }, annotations: { readOnlyHint: true } },
    async ({ status }) => {
      const q = status ? `&dispute_state=${encodeURIComponent(status)}` : "";
      const { data } = await client.request<{ items?: unknown[] }>("GET", `/v1/customer/disputes?page_size=50${q}`);
      return text(redactObject(data.items ?? []));
    },
  );

  server.registerTool(
    "get_dispute",
    { title: "Get a PayPal dispute", description: "Dispute details (PII redacted) plus the actions PayPal allows right now (HATEOAS).", inputSchema: { dispute_id: z.string().regex(/^PP-[A-Z0-9-]{3,40}$/) }, annotations: { readOnlyHint: true } },
    async ({ dispute_id }) => {
      const d = await getDispute(client as PayPalClient, dispute_id);
      return text({ allowed_actions: availableActions(d), dispute: redactObject(d) });
    },
  );

}

function registerCustomTools(server: McpServer, client: Client, opts: McpOptions) {
  const replay = opts.replay;
  for (const [name, def] of Object.entries(customDisputeTools) as [CustomToolName, (typeof customDisputeTools)[CustomToolName]][]) {
    // Files are binary; over MCP the evidence tool takes JSON fields only (tracking, notes, refund ids).
    const shape = name === "provide_dispute_evidence" ? (def.parameters as z.AnyZodObject).omit({ files: true }).shape : (def.parameters as z.AnyZodObject).shape;
    server.registerTool(
      name,
      {
        title: def.name,
        description: replay
          ? `${def.description} REPLAY: nothing is sent; returns the request that would go to PayPal, allowed only when the recorded dispute offers "${def.action}".`
          : `${def.description} PayPal sandbox only; allowed only when PayPal offers "${def.action}" on the dispute.`,
        inputSchema: shape,
        annotations: { destructiveHint: !replay, readOnlyHint: Boolean(replay) },
      },
      async (args: Record<string, unknown>) => {
        if (!replay && !opts.allowWrites) return fail("Write tools are disabled. Start the server with DD_MCP_ALLOW_WRITES=1 (PayPal sandbox only).");
        try {
          const res = await runCustomDisputeTool(client as PayPalClient, name, args);
          if (replay) {
            const req = replay.captured.at(-1);
            return text({ sent: false, mode: "Replay: nothing was sent to PayPal", allowed_by_recorded_dispute: true, would_send: req && { method: req.method, endpoint: req.endpoint, body: req.body } });
          }
          return text({ status: res.status, debug_id: res.debugId });
        } catch (e) {
          return fail(scrub(e instanceof Error ? e.message : "PayPal request failed"));
        }
      },
    );
  }
}
