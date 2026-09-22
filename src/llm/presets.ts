/**
 * Every provider Conduit knows how to reach.
 *
 * Almost all of them speak OpenAI's chat-completions dialect, so adding one is
 * a base URL and a place to get a key. Anthropic and Google have native
 * clients here because their own APIs expose things the compatibility layers
 * do not (extended thinking, prompt caching), but they are configured the
 * same way.
 */

export interface ProviderPreset {
  id: string;
  label: string;
  /** Empty for native providers, which have their own client. */
  baseUrl: string;
  native?: boolean;
  needsKey: boolean;
  keyUrl?: string;
  /** Runs on this machine or network. */
  local?: boolean;
  /** Tile colour. Brand-adjacent, never a logo. */
  hue: number;
  blurb: string;
  /** How the key is sent when listing models. */
  auth?: { header: string; template: string; extra?: Record<string, string> };
  /** Where the model list lives, when it is not `${baseUrl}/models`. */
  modelsUrl?: string;
}

export const PRESETS: ProviderPreset[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    baseUrl: "",
    native: true,
    needsKey: true,
    keyUrl: "https://console.anthropic.com/settings/keys",
    hue: 24,
    blurb: "Claude models.",
    auth: { header: "x-api-key", template: "{key}", extra: { "anthropic-version": "2023-06-01" } },
    modelsUrl: "https://api.anthropic.com/v1/models",
  },
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    needsKey: true,
    keyUrl: "https://platform.openai.com/api-keys",
    hue: 160,
    blurb: "GPT models.",
  },
  {
    id: "google",
    label: "Google Gemini",
    baseUrl: "",
    native: true,
    needsKey: true,
    keyUrl: "https://aistudio.google.com/apikey",
    hue: 215,
    blurb: "Gemini models.",
    modelsUrl: "https://generativelanguage.googleapis.com/v1beta/openai/models",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    needsKey: true,
    keyUrl: "https://openrouter.ai/keys",
    hue: 250,
    blurb: "Hundreds of models behind one key.",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    needsKey: true,
    keyUrl: "https://platform.deepseek.com/api_keys",
    hue: 225,
    blurb: "DeepSeek chat and reasoning models.",
  },
  {
    id: "mistral",
    label: "Mistral AI",
    baseUrl: "https://api.mistral.ai/v1",
    needsKey: true,
    keyUrl: "https://console.mistral.ai/api-keys",
    hue: 28,
    blurb: "Mistral and Codestral.",
  },
  {
    id: "xai",
    label: "xAI",
    baseUrl: "https://api.x.ai/v1",
    needsKey: true,
    keyUrl: "https://console.x.ai",
    hue: 0,
    blurb: "Grok models.",
  },
  {
    id: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    needsKey: true,
    keyUrl: "https://console.groq.com/keys",
    hue: 12,
    blurb: "Very fast inference for open models.",
  },
  {
    id: "moonshot",
    label: "Kimi",
    baseUrl: "https://api.moonshot.ai/v1",
    needsKey: true,
    keyUrl: "https://platform.moonshot.ai/console/api-keys",
    hue: 200,
    blurb: "Moonshot's Kimi models.",
  },
  {
    id: "qwen",
    label: "Qwen (DashScope)",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    needsKey: true,
    keyUrl: "https://modelstudio.console.alibabacloud.com",
    hue: 265,
    blurb: "Alibaba's Qwen models.",
  },
  {
    id: "zai",
    label: "Z.ai",
    baseUrl: "https://api.z.ai/api/paas/v4",
    needsKey: true,
    keyUrl: "https://z.ai/manage-apikey/apikey-list",
    hue: 190,
    blurb: "GLM models.",
  },
  {
    id: "huggingface",
    label: "Hugging Face",
    baseUrl: "https://router.huggingface.co/v1",
    needsKey: true,
    keyUrl: "https://huggingface.co/settings/tokens",
    hue: 45,
    blurb: "Inference providers through one token.",
  },
  {
    id: "together",
    label: "Together AI",
    baseUrl: "https://api.together.xyz/v1",
    needsKey: true,
    keyUrl: "https://api.together.ai/settings/api-keys",
    hue: 230,
    blurb: "Open models, hosted.",
  },
  {
    id: "fireworks",
    label: "Fireworks",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    needsKey: true,
    keyUrl: "https://fireworks.ai/account/api-keys",
    hue: 280,
    blurb: "Open models, hosted.",
  },
  {
    id: "cerebras",
    label: "Cerebras",
    baseUrl: "https://api.cerebras.ai/v1",
    needsKey: true,
    keyUrl: "https://cloud.cerebras.ai",
    hue: 20,
    blurb: "Wafer-scale fast inference.",
  },
  {
    id: "perplexity",
    label: "Perplexity",
    baseUrl: "https://api.perplexity.ai",
    needsKey: true,
    keyUrl: "https://www.perplexity.ai/settings/api",
    hue: 180,
    blurb: "Models with web search built in.",
  },
  {
    id: "nvidia",
    label: "NVIDIA NIM",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    needsKey: true,
    keyUrl: "https://build.nvidia.com",
    hue: 85,
    blurb: "NVIDIA-hosted open models.",
  },
  {
    id: "sambanova",
    label: "SambaNova",
    baseUrl: "https://api.sambanova.ai/v1",
    needsKey: true,
    keyUrl: "https://cloud.sambanova.ai/apis",
    hue: 35,
    blurb: "Fast hosted Llama and DeepSeek.",
  },
  {
    id: "ollama",
    label: "Ollama",
    baseUrl: "http://localhost:11434/v1",
    needsKey: false,
    local: true,
    hue: 0,
    blurb: "Models you run with Ollama.",
  },
  {
    id: "lmstudio",
    label: "LM Studio",
    baseUrl: "http://localhost:1234/v1",
    needsKey: false,
    local: true,
    hue: 240,
    blurb: "LM Studio's local server.",
  },
  {
    id: "llamacpp",
    label: "llama.cpp server",
    baseUrl: "http://localhost:8080/v1",
    needsKey: false,
    local: true,
    hue: 30,
    blurb: "A llama-server you started yourself.",
  },
  {
    id: "vllm",
    label: "vLLM",
    baseUrl: "http://localhost:8000/v1",
    needsKey: false,
    local: true,
    hue: 210,
    blurb: "A vLLM server on this machine or network.",
  },
  {
    id: "custom",
    label: "Custom",
    baseUrl: "",
    needsKey: true,
    hue: 0,
    blurb: "Anything that speaks the OpenAI chat format.",
  },
];

export function presetFor(id: string): ProviderPreset | undefined {
  return PRESETS.find((p) => p.id === id);
}
