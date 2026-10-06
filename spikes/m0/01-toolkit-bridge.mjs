// Verify: Agent Toolkit runs on sandbox, tool names, zod -> JSON Schema bridge for Claude tools.
import { PayPalMCPToolkit } from '@paypal/agent-toolkit/mcp';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { token, log } from './env.mjs';
const tk = new PayPalMCPToolkit({ accessToken: await token(), configuration: {
  actions: { disputes: { list: true, get: true, create: true }, shipment: { create: true, get: true }, transactions: { list: true }, orders: { create: true, get: true, capture: true } },
  context: { sandbox: true } } });
const api = tk.getPaypalAPIService();
log('toolkit baseUrl:', api.baseUrl);
const tools = tk.getTools();
log('enabled tools:', tools.map(t => t.method).join(', '));
const claudeTools = tools.map(t => ({ name: t.method, description: t.description.slice(0, 80) + '…', input_schema: zodToJsonSchema(t.parameters, { target: 'jsonSchema7', $refStrategy: 'none' }) }));
log('example Claude tool (get_dispute):', claudeTools.find(t => t.name === 'get_dispute'));
log('list_disputes result:', (await api.run('list_disputes', {})).slice(0, 500));
// Check default when sandbox omitted (must NOT be used): 
const { PayPalAPI } = await import('@paypal/agent-toolkit/mcp');
log('default baseUrl without sandbox flag:', new PayPalAPI('x', {}).baseUrl);
