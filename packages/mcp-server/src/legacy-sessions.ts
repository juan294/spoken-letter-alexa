// Session-id contingency for Amazon's Local Inspector (Phase 7, section 2). Opt-in via
// `MCP_LEGACY_SESSIONS=1`; the main handler in `server.ts` stays stateless and dual-era.
//
// Legacy (2025-era) requests, classified by the SDK's own `isLegacyRequest`, are served
// by one sessionful `WebStandardStreamableHTTPServerTransport` per session, held in an
// in-memory map. Modern (2026-07-28) requests go to a `legacy: 'reject'` handler. This
// is the composition the SDK documents for keeping a sessionful legacy deployment next
// to a strict modern endpoint. It is single-instance only: sessions live in process
// memory, so it runs on one Fargate task (`infra/lib/legacy-stack.ts`), never on Lambda.
import { randomUUID } from "node:crypto";

import {
  createMcpHandler,
  isLegacyRequest,
  WebStandardStreamableHTTPServerTransport,
  type McpHandlerRequestOptions,
  type McpServerFactory,
} from "@modelcontextprotocol/server";

export type LegacySessionOptions = {
  /** Reporting only; never alters a response. */
  onerror?: ((error: Error) => void) | undefined;
  /** Defaults to `randomUUID`. */
  sessionIdGenerator?: (() => string) | undefined;
};

export type LegacySessionHandler = {
  /** Web-standard face, mounted like `McpHttpHandler.fetch`. */
  fetch: (request: Request, options?: McpHandlerRequestOptions) => Promise<Response>;
  /** Closes every open legacy session and the modern leg. */
  close: () => Promise<void>;
  /** Open legacy sessions right now (observability and tests). */
  sessionCount: () => number;
};

const JSON_HEADERS = { "content-type": "application/json" };

function jsonRpcError(status: number, code: number, message: string): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }), { status, headers: JSON_HEADERS });
}

/**
 * Builds the sessionful legacy handler in front of a modern-only handler. The factory
 * is the same one `createMcpHandler` takes; the legacy leg calls it once per session with
 * `era: 'legacy'`, so tools registered by the factory serve both eras unchanged.
 */
export function createLegacySessionHandler(factory: McpServerFactory, options: LegacySessionOptions = {}): LegacySessionHandler {
  const onerror = options.onerror;
  const sessionIdGenerator = options.sessionIdGenerator ?? randomUUID;
  const sessions = new Map<string, WebStandardStreamableHTTPServerTransport>();
  // The ONLY permitted `legacy: 'reject'`: legacy traffic never reaches this handler.
  const modern = createMcpHandler(factory, { legacy: "reject", ...(onerror && { onerror }) });

  async function openTransport(request: Request, authInfo: McpHandlerRequestOptions["authInfo"]) {
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator,
      onsessioninitialized: (sessionId) => {
        sessions.set(sessionId, transport);
      },
      onsessionclosed: (sessionId) => {
        sessions.delete(sessionId);
      },
    });
    if (onerror) transport.onerror = onerror;
    const server = await factory({ era: "legacy", ...(authInfo && { authInfo }), requestInfo: request });
    await server.connect(transport);
    return transport;
  }

  async function serveLegacy(request: Request, requestOptions: McpHandlerRequestOptions | undefined): Promise<Response> {
    const sessionId = request.headers.get("mcp-session-id");
    if (sessionId !== null) {
      const transport = sessions.get(sessionId);
      if (!transport) {
        onerror?.(new Error("Session not found"));
        return jsonRpcError(404, -32001, "Session not found");
      }
      return transport.handleRequest(request, requestOptions);
    }
    // No session header: only `initialize` may open a session. A fresh stateful transport
    // mints the id for an initialize and answers 400 for anything else (its own check).
    const transport = await openTransport(request, requestOptions?.authInfo);
    const response = await transport.handleRequest(request, requestOptions);
    if (transport.sessionId === undefined) await transport.close();
    return response;
  }

  return {
    fetch: async (request, requestOptions) => {
      if (await isLegacyRequest(request, requestOptions?.parsedBody)) return serveLegacy(request, requestOptions);
      return modern.fetch(request, requestOptions);
    },
    close: async () => {
      const open = [...sessions.values()];
      sessions.clear();
      await Promise.all(open.map((transport) => transport.close()));
      await modern.close();
    },
    sessionCount: () => sessions.size,
  };
}
