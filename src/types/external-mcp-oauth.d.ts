declare module "@mariozechner/pi-ai/oauth" {
  import type { OAuthCredentials as BaseOAuthCredentials } from "@mariozechner/pi-ai";

  export type OAuthProvider = string;

  export type OAuthCredentials = BaseOAuthCredentials;

  export function getOAuthProviders(): Array<{ id: OAuthProvider }>;
  export function getOAuthApiKey(
    provider: OAuthProvider,
    credentialsByProvider: Record<string, OAuthCredentials>,
  ): Promise<{ apiKey: string; newCredentials: OAuthCredentials } | null>;

  export function loginOpenAICodex(params: {
    onAuth?: (event: { url: string }) => Promise<void> | void;
    onPrompt?: (prompt: { message: string; placeholder?: string }) => Promise<string> | string;
    onProgress?: (message: string) => void;
  }): Promise<OAuthCredentials | null>;
}

declare module "@modelcontextprotocol/sdk/client/index.js" {
  export type ListToolsResult = {
    tools: Array<{
      name: string;
      title?: string;
      description?: string;
      inputSchema?: Record<string, unknown>;
    }>;
    nextCursor?: string;
  };

  export class Client {
    constructor(info: { name: string; version: string }, options?: Record<string, unknown>);
    connect(transport: unknown): Promise<void>;
    close(): Promise<void>;
    listTools(params?: { cursor?: string }): Promise<ListToolsResult>;
    callTool(params: {
      name: string;
      arguments?: Record<string, unknown>;
    }): Promise<unknown>;
  }
}

declare module "@modelcontextprotocol/sdk/client/stdio.js" {
  export class StdioClientTransport {
    constructor(params: {
      command: string;
      args?: string[];
      env?: NodeJS.ProcessEnv;
      cwd?: string;
      stderr?: "pipe" | "inherit";
    });
    pid: number | null;
    stderr?: {
      on?: (event: "data", handler: (chunk: Buffer | string) => void) => void;
      off?: (event: "data", handler: (chunk: Buffer | string) => void) => void;
      removeListener?: (event: "data", handler: (chunk: Buffer | string) => void) => void;
    };
    close(): Promise<void>;
  }
}

declare module "@modelcontextprotocol/sdk/types.js" {
  export type CallToolResult = {
    content?: unknown[];
    structuredContent?: unknown;
    isError?: boolean;
  };
}
