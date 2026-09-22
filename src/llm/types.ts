/**
 * One shape for every model provider.
 *
 * The agent loop is written once against this interface, so adding a provider
 * never touches the loop — which is the only way a plugin ecosystem stays sane.
 */

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the arguments. */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ImageContent {
  /** Raw base64, no data: prefix. */
  base64: string;
  mediaType: "image/png" | "image/jpeg";
}

export type Msg =
  /**
   * Screenshots ride on user messages rather than tool results. Every provider
   * accepts an image in a user turn; only some accept one inside a tool result,
   * and a portable abstraction cannot depend on the difference.
   */
  | { role: "user"; text: string; image?: ImageContent }
  | { role: "assistant"; text?: string; calls?: ToolCall[] }
  | { role: "tool"; callId: string; name: string; result: string; isError?: boolean };

export interface CompleteRequest {
  model: string;
  system: string;
  messages: Msg[];
  tools?: ToolSpec[];
  maxTokens?: number;
  /** Anthropic's effort dial; other providers map it onto what they have. */
  effort?: "low" | "medium" | "high";
  /** Latency-critical, no tools — lets a provider skip reasoning entirely. */
  fastPath?: boolean;
  signal?: AbortSignal;
}

export interface CompleteResult {
  text: string;
  calls: ToolCall[];
  stopReason: string;
  usage?: { input: number; output: number };
}

export interface Provider {
  readonly id: string;
  readonly label: string;
  /** Presented in Settings; the user can always type a model id by hand. */
  readonly suggestedModels: readonly string[];
  complete(req: CompleteRequest): Promise<CompleteResult>;
  /**
   * Streams the reply, calling `onDelta` for each fragment of visible text.
   * Optional: a provider without it simply feels slower, never broken.
   */
  completeStream?(req: CompleteRequest, onDelta: (text: string) => void): Promise<CompleteResult>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
