import axios from 'axios';
import { HELP_ASSISTANT_KNOWLEDGE } from '../data/helpAssistantKnowledge';

export class HelpAssistantServiceError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number = 400) {
    super(message);
    this.name = 'HelpAssistantServiceError';
    this.statusCode = statusCode;
  }
}

/** True only if a real Anthropic API key is configured for this environment. */
export function isHelpAssistantConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-sonnet-5';
const MAX_TOOL_ITERATIONS = 5;

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// Each tool is a thin, read-only wrapper around an EXISTING authenticated
// endpoint - the assistant calls the same route a human would, forwarding
// the SAME caller credentials it was invoked with, rather than
// reimplementing that route's role/warehouse-scoping logic here. This is
// deliberate: a Cashier's help assistant can only ever see what a Cashier
// can already see through the normal UI, by construction, not by a
// second, easier-to-get-wrong copy of the access-control rules.
interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  // How to turn the tool's input into an internal API call.
  call: (input: any) => { method: 'GET'; path: string; params?: Record<string, unknown> };
}

const TOOLS: ToolDefinition[] = [
  {
    name: 'list_invoices',
    description: "List this business's invoices (customer, status, total, amount paid, due date). Use to answer questions about specific invoices or overall receivables.",
    input_schema: { type: 'object', properties: {} },
    call: () => ({ method: 'GET', path: '/invoices' }),
  },
  {
    name: 'get_invoice_payment_history',
    description: 'Get the full payment history (every partial or full payment) recorded against one specific invoice.',
    input_schema: {
      type: 'object',
      properties: { invoiceId: { type: 'string', description: 'The invoice ID (from list_invoices).' } },
      required: ['invoiceId'],
    },
    call: (input) => ({ method: 'GET', path: `/invoices/${encodeURIComponent(input.invoiceId)}/payments` }),
  },
  {
    name: 'get_ledger_summary',
    description: "General ledger summary: every account's closing balance. Use for trial-balance-style questions ('what's my cash balance', 'why does revenue look wrong'). Not available to every role - if this is denied, tell the user their role does not have ledger access.",
    input_schema: { type: 'object', properties: {} },
    call: () => ({ method: 'GET', path: '/ledgers/summary' }),
  },
  {
    name: 'get_till_status',
    description: "The currently OPEN cash till (if any) for this shop, including its sales so far this shift. Use for POS/till questions.",
    input_schema: { type: 'object', properties: {} },
    call: () => ({ method: 'GET', path: '/tills/current' }),
  },
  {
    name: 'list_expense_claims',
    description: 'List expense claims and their status (pending/approved/rejected/reimbursed).',
    input_schema: { type: 'object', properties: {} },
    call: () => ({ method: 'GET', path: '/expense-claims' }),
  },
  {
    name: 'list_accounts',
    description: 'List the Chart of Accounts, including which single account (if any) is designated the default Cash/Revenue/Expense posting target. Use when a user asks why a payment posted somewhere unexpected, or what accounts they have.',
    input_schema: { type: 'object', properties: {} },
    call: () => ({ method: 'GET', path: '/accounts' }),
  },
  {
    name: 'get_tenant_plan',
    description: "This business's current plan tier (Shop/Business/Enterprise) and profile. Use to answer 'why is this feature locked' or 'what plan am I on'.",
    input_schema: { type: 'object', properties: {} },
    call: () => ({ method: 'GET', path: '/tenants/current' }),
  },
];

const SYSTEM_PROMPT = `You are the in-app Help Assistant for Ledgio, a multi-tenant accounting platform. You help the logged-in user understand and use the app, answering from the reference material below and, when useful, by looking up that specific business's own real data with your tools.

Rules:
- Be concise and practical - this is a chat widget, not an essay. A few sentences is usually enough.
- You are READ-ONLY. You cannot create, edit, or delete anything. If asked to perform an action, explain how to do it in the UI yourself, and say you can't do it directly.
- Only use your tools when the answer genuinely depends on this business's actual data (e.g. "why is invoice X unpaid"). For general "how does X work" questions, just answer from the reference material.
- If a tool call is denied (403) because of the user's role, tell them plainly that their role doesn't have access to that data, rather than guessing.
- Never invent data. If a tool doesn't return what you need, say so.

Reference material:
${HELP_ASSISTANT_KNOWLEDGE}`;

function buildInternalApiClient(authHeader: string, tenantHeader: string) {
  const baseURL = `http://localhost:${process.env.PORT || 4000}/api/v1`;
  return axios.create({
    baseURL,
    headers: { Authorization: authHeader, 'X-Tenant-Id': tenantHeader },
    timeout: 15000,
    validateStatus: () => true, // handle non-2xx ourselves - a 403 is a legitimate, informative tool result, not a thrown error
  });
}

async function callAnthropic(messages: any[], tools: any[]): Promise<any> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new HelpAssistantServiceError('Help Assistant is not configured for this environment.', 503);
  }

  try {
    const response = await axios.post(
      ANTHROPIC_API_URL,
      {
        model: process.env.HELP_ASSISTANT_MODEL || DEFAULT_MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages,
        tools: tools.map(({ name, description, input_schema }) => ({ name, description, input_schema })),
      },
      {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          'content-type': 'application/json',
        },
        timeout: 30000,
      }
    );
    return response.data;
  } catch (error: any) {
    throw new HelpAssistantServiceError(
      error.response?.data?.error?.message || error.message || 'Help Assistant request failed.',
      error.response?.status && error.response.status < 500 ? 502 : 503
    );
  }
}

/**
 * Answers one turn of a help conversation, running the tool-use loop
 * (look something up, feed the result back, repeat) until Claude produces
 * a final text answer. `authHeader`/`tenantHeader` are the CALLING USER'S
 * real credentials, forwarded verbatim to every tool call - see the
 * ToolDefinition comment above for why.
 */
export async function chat(
  userMessage: string,
  history: ChatMessage[],
  authHeader: string,
  tenantHeader: string
): Promise<{ reply: string; history: ChatMessage[] }> {
  if (!userMessage || typeof userMessage !== 'string' || !userMessage.trim()) {
    throw new HelpAssistantServiceError('A message is required.', 400);
  }

  const apiClient = buildInternalApiClient(authHeader, tenantHeader);
  const messages: any[] = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage.trim() },
  ];

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const response = await callAnthropic(messages, TOOLS);

    if (response.stop_reason !== 'tool_use') {
      const reply = (response.content || [])
        .filter((block: any) => block.type === 'text')
        .map((block: any) => block.text)
        .join('\n')
        .trim();
      const finalHistory: ChatMessage[] = [...history, { role: 'user', content: userMessage.trim() }, { role: 'assistant', content: reply }];
      return { reply: reply || "I wasn't able to come up with an answer for that - could you rephrase?", history: finalHistory };
    }

    messages.push({ role: 'assistant', content: response.content });

    const toolResults = await Promise.all(
      response.content
        .filter((block: any) => block.type === 'tool_use')
        .map(async (block: any) => {
          const tool = TOOLS.find((t) => t.name === block.name);
          if (!tool) {
            return { type: 'tool_result', tool_use_id: block.id, content: `Unknown tool "${block.name}".`, is_error: true };
          }
          try {
            const { method, path, params } = tool.call(block.input || {});
            const apiRes = await apiClient.request({ method, url: path, params });
            if (apiRes.status >= 400) {
              return {
                type: 'tool_result',
                tool_use_id: block.id,
                content: `Request denied (${apiRes.status}): ${apiRes.data?.error || 'access not permitted for this role.'}`,
                is_error: true,
              };
            }
            return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(apiRes.data?.data ?? apiRes.data) };
          } catch (err: any) {
            return { type: 'tool_result', tool_use_id: block.id, content: `Lookup failed: ${err.message}`, is_error: true };
          }
        })
    );

    messages.push({ role: 'user', content: toolResults });
  }

  throw new HelpAssistantServiceError('Help Assistant could not resolve this request after several lookups - please try rephrasing your question.', 502);
}
