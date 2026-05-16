import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { logger } from "./logger";

// ── Singleton Pipeboard MCP client shared by lib modules ──────────────────────
// ai.ts and pipeboard.ts each maintain their own singletons for historical reasons;
// this one is used by pipeboard-meta.ts (dashboard data via Pipeboard).
let _client: Client | null = null;
let _connecting: Promise<Client> | null = null;

async function getClient(): Promise<Client> {
  if (_client) return _client;
  if (_connecting) return _connecting;
  _connecting = (async () => {
    const token = process.env.PIPEBOARD_API_TOKEN;
    if (!token) throw new Error("PIPEBOARD_API_TOKEN not set");
    const c = new Client({ name: "meta-ads-dashboard-lib", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL("https://mcp.pipeboard.co/meta-ads-mcp"),
      { requestInit: { headers: { Authorization: `Bearer ${token}` } } }
    );
    await c.connect(transport);
    _client = c;
    _connecting = null;
    logger.info("Pipeboard lib-client connected");
    return c;
  })();
  try {
    return await _connecting;
  } catch (err) {
    _connecting = null;
    throw err;
  }
}

/** Call a Pipeboard MCP tool and return the raw text content. */
export async function callPipeboardTool(
  toolName: string,
  toolArgs: Record<string, unknown>
): Promise<string> {
  try {
    const client = await getClient();
    const result = await client.callTool({ name: toolName, arguments: toolArgs });
    const content = result.content as Array<{ type: string; text?: string }>;
    const raw = content.filter(c => c.type === "text").map(c => c.text ?? "").join("\n").trim();
    if (result.isError) {
      // Error 190 = Meta token stored in Pipeboard has expired
      const isExpiry = /\b190\b|session.*expired|access.*token.*invalid|OAuthException/i.test(raw);
      if (isExpiry) {
        throw new Error(`PIPEBOARD_TOKEN_EXPIRED: ${raw.slice(0, 300)}`);
      }
      throw new Error(raw || "Pipeboard tool error");
    }
    return raw;
  } catch (err) {
    // Reset singleton on any error so next call reconnects fresh
    _client = null;
    _connecting = null;
    throw err;
  }
}
