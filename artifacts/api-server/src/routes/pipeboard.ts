import { Router, type Request, type Response } from "express";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const router = Router();

router.post("/pipeboard/action", async (req: Request, res: Response) => {
  if (req.session?.role !== "admin") {
    res.status(403).json({ error: "غير مصرح — هذه الميزة للأدمن فقط" });
    return;
  }

  const { tool, args } = req.body as { tool: string; args: Record<string, unknown> };
  if (!tool) {
    res.status(400).json({ error: "tool مطلوب" });
    return;
  }

  const token = process.env.PIPEBOARD_API_TOKEN;
  if (!token) {
    res.status(500).json({ error: "PIPEBOARD_API_TOKEN غير مضبوط على السيرفر" });
    return;
  }

  const client = new Client({ name: "meta-ads-dashboard", version: "1.0.0" });
  const url = new URL("https://mcp.pipeboard.co/meta-ads-mcp");
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });

  try {
    await client.connect(transport);
    const result = await client.callTool({ name: tool, arguments: args ?? {} });

    const textContent = (result.content as Array<{ type: string; text?: string }>)
      ?.filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("\n")
      .trim();

    res.json({ success: true, message: textContent || "تم التنفيذ بنجاح" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  } finally {
    await client.close().catch(() => null);
  }
});

export default router;
