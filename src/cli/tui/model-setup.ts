import type { ModelProviderName } from "../../model/model-client.js";
import type { ModelProviderProfile } from "../../model/provider-profiles.js";
import { ansi, clip, type TerminalSize } from "./ansi.js";

export type RichModelSetupProfile = Pick<
  ModelProviderProfile,
  | "name"
  | "displayName"
  | "protocol"
  | "defaultBaseUrl"
  | "defaultModel"
  | "apiKeyEnvNames"
  | "modelIds"
  | "docsUrl"
  | "apiKeysUrl"
  | "pricingUrl"
>;

export type RichModelSetupPhase = "provider" | "base_url" | "model" | "custom_model" | "api_key";

export type RichModelSetupProviderOption = {
  id: string;
  provider: ModelProviderName;
  displayName: string;
  protocol: ModelProviderProfile["protocol"];
  baseUrl?: string;
  defaultModel: string;
  modelIds: string[];
  apiKeyEnvNames: string[];
  docsUrl?: string;
  apiKeysUrl?: string;
  pricingUrl?: string;
};

export type RichModelSetupRequest = {
  provider: ModelProviderName;
  protocol: ModelProviderProfile["protocol"];
  baseUrl?: string;
  model: string;
  apiKey?: string;
  apiKeyEnvNames: string[];
};

export type RichModelSetupState = {
  open: true;
  phase: RichModelSetupPhase;
  providerOptions: RichModelSetupProviderOption[];
  providerCursor: number;
  selectedProviderIndex?: number;
  selectedBaseUrl?: string;
  baseUrlInput: string;
  modelCursor: number;
  selectedModel?: string;
  customModelInput: string;
  apiKeyInput: string;
  error?: string;
};

export type RichModelSetupKey = {
  ctrl?: boolean;
  name?: string;
};

export type RichModelSetupKeyInput = {
  value?: string;
  key?: RichModelSetupKey;
};

export type RichModelSetupAction =
  | { type: "redraw" }
  | { type: "cancel" }
  | { type: "complete"; request: RichModelSetupRequest };

const MODEL_SETUP_PROVIDER_ORDER: ModelProviderName[] = [
  "openai",
  "anthropic",
  "gemini",
  "kimi",
  "deepseek",
  "glm",
  "qwen",
  "minimax",
  "grok",
  "mimo",
  "openai_compatible",
  "anthropic_compatible",
  "mock",
];

export function createRichModelSetupState(profiles: RichModelSetupProfile[], currentProvider?: string): RichModelSetupState {
  const byName = new Map(profiles.map((profile) => [profile.name, profile]));
  const baseProviderOptions = MODEL_SETUP_PROVIDER_ORDER
    .map((name) => byName.get(name))
    .filter((profile): profile is RichModelSetupProfile => Boolean(profile))
    .map(modelSetupProviderOption);
  const providerOptions = appendOpenAIResponsesModelSetupOption(baseProviderOptions);
  const providerCursor = Math.max(0, providerOptions.findIndex((option) => option.id === currentProvider || option.provider === currentProvider));
  return {
    open: true,
    phase: "provider",
    providerOptions,
    providerCursor,
    baseUrlInput: "",
    modelCursor: 0,
    customModelInput: "",
    apiKeyInput: "",
  };
}

export function handleRichModelSetupKey(state: RichModelSetupState, input: RichModelSetupKeyInput): RichModelSetupAction {
  const key = input.key ?? {};
  const value = input.value;
  state.error = undefined;
  if ((key.ctrl && key.name === "c") || key.name === "escape") {
    return { type: "cancel" };
  }
  if (state.phase === "provider") {
    return handleProviderKey(state, value, key);
  }
  if (state.phase === "base_url") {
    return handleBaseUrlKey(state, value, key);
  }
  if (state.phase === "model") {
    return handleModelKey(state, value, key);
  }
  if (state.phase === "custom_model") {
    return handleCustomModelKey(state, value, key);
  }
  return handleApiKeyKey(state, value, key);
}

export function renderRichModelSetupScreen(state: RichModelSetupState, size: TerminalSize): string {
  const width = Math.max(size.columns, 48);
  const height = Math.max(size.rows, 16);
  const lines = [
    `${ansi.bold}soloclaw${ansi.reset}`,
    "",
    `${ansi.bold}Model setup${ansi.reset}`,
    renderStepLine(state),
    "",
    ...renderPhaseLines(state, width),
  ];
  while (lines.length < height - 2) {
    lines.push("");
  }
  lines.push(`${ansi.gray}Up/Down move - Space select - Enter confirm - Esc cancel${ansi.reset}`);
  return lines.slice(0, height).map((line) => clip(line, width)).join("\n");
}

function handleProviderKey(state: RichModelSetupState, value: string | undefined, key: RichModelSetupKey): RichModelSetupAction {
  if (key.name === "up") {
    state.providerCursor = wrapIndex(state.providerCursor - 1, state.providerOptions.length);
    return { type: "redraw" };
  }
  if (key.name === "down") {
    state.providerCursor = wrapIndex(state.providerCursor + 1, state.providerOptions.length);
    return { type: "redraw" };
  }
  if (value === " " || key.name === "space" || key.name === "return" || key.name === "enter") {
    state.selectedProviderIndex = state.providerCursor;
    state.selectedBaseUrl = undefined;
    state.baseUrlInput = "";
    state.modelCursor = 0;
    state.selectedModel = undefined;
    state.customModelInput = "";
    state.apiKeyInput = "";
    state.phase = requiresCustomBaseUrl(selectedProvider(state)) ? "base_url" : "model";
    return { type: "redraw" };
  }
  return { type: "redraw" };
}

function handleBaseUrlKey(state: RichModelSetupState, value: string | undefined, key: RichModelSetupKey): RichModelSetupAction {
  if (key.ctrl && key.name === "u") {
    state.baseUrlInput = "";
    return { type: "redraw" };
  }
  if (key.name === "backspace") {
    state.baseUrlInput = state.baseUrlInput.slice(0, -1);
    return { type: "redraw" };
  }
  if (key.name === "return" || key.name === "enter") {
    const provider = selectedProvider(state);
    const baseUrl = state.baseUrlInput.trim() || provider.baseUrl;
    if (!baseUrl || !isHttpUrl(baseUrl)) {
      state.error = "Base URL must be an http(s) URL.";
      return { type: "redraw" };
    }
    state.selectedBaseUrl = baseUrl;
    state.phase = "model";
    return { type: "redraw" };
  }
  if (value && value >= " " && value !== "\x7f") {
    state.baseUrlInput += value;
  }
  return { type: "redraw" };
}

function handleModelKey(state: RichModelSetupState, value: string | undefined, key: RichModelSetupKey): RichModelSetupAction {
  const choices = selectedProvider(state).modelIds;
  const count = choices.length + 1;
  if (key.name === "up") {
    state.modelCursor = wrapIndex(state.modelCursor - 1, count);
    return { type: "redraw" };
  }
  if (key.name === "down") {
    state.modelCursor = wrapIndex(state.modelCursor + 1, count);
    return { type: "redraw" };
  }
  if (value === " " || key.name === "space" || key.name === "return" || key.name === "enter") {
    if (state.modelCursor >= choices.length) {
      state.phase = "custom_model";
      state.customModelInput = "";
      return { type: "redraw" };
    }
    state.selectedModel = choices[state.modelCursor] ?? selectedProvider(state).defaultModel;
    return moveToApiKeyOrComplete(state);
  }
  return { type: "redraw" };
}

function handleCustomModelKey(state: RichModelSetupState, value: string | undefined, key: RichModelSetupKey): RichModelSetupAction {
  if (key.name === "backspace") {
    state.customModelInput = state.customModelInput.slice(0, -1);
    return { type: "redraw" };
  }
  if (key.name === "return" || key.name === "enter") {
    const model = state.customModelInput.trim();
    if (!model) {
      state.error = "Model ID cannot be empty.";
      return { type: "redraw" };
    }
    state.selectedModel = model;
    return moveToApiKeyOrComplete(state);
  }
  if (value && value >= " " && value !== "\x7f") {
    state.customModelInput += value;
  }
  return { type: "redraw" };
}

function handleApiKeyKey(state: RichModelSetupState, value: string | undefined, key: RichModelSetupKey): RichModelSetupAction {
  if (key.name === "backspace") {
    state.apiKeyInput = state.apiKeyInput.slice(0, -1);
    return { type: "redraw" };
  }
  if (key.name === "return" || key.name === "enter") {
    if (!state.apiKeyInput.trim()) {
      state.error = "API key cannot be empty.";
      return { type: "redraw" };
    }
    return { type: "complete", request: buildRequest(state, state.apiKeyInput.trim()) };
  }
  if (value && value >= " " && value !== "\x7f") {
    state.apiKeyInput += value;
  }
  return { type: "redraw" };
}

function moveToApiKeyOrComplete(state: RichModelSetupState): RichModelSetupAction {
  if (selectedProvider(state).protocol === "mock") {
    return { type: "complete", request: buildRequest(state, undefined) };
  }
  state.phase = "api_key";
  state.apiKeyInput = "";
  return { type: "redraw" };
}

function buildRequest(state: RichModelSetupState, apiKey: string | undefined): RichModelSetupRequest {
  const provider = selectedProvider(state);
  return {
    provider: provider.provider,
    protocol: provider.protocol,
    baseUrl: state.selectedBaseUrl ?? provider.baseUrl,
    model: state.selectedModel ?? provider.defaultModel,
    apiKey,
    apiKeyEnvNames: provider.apiKeyEnvNames,
  };
}

function renderStepLine(state: RichModelSetupState): string {
  const step = state.phase === "provider"
    ? "1/4 Provider"
    : state.phase === "base_url"
      ? "2/4 Base URL"
      : state.phase === "model" || state.phase === "custom_model"
        ? "3/4 Model"
        : "4/4 API key";
  return `${ansi.orange}${step}${ansi.reset}`;
}

function renderPhaseLines(state: RichModelSetupState, width: number): string[] {
  const lines: string[] = [];
  if (state.error) {
    lines.push(`${ansi.orange}${state.error}${ansi.reset}`);
    lines.push("");
  }
  if (state.phase === "provider") {
    lines.push(...state.providerOptions.map((option, index) => renderChoiceLine(index, state.providerCursor, providerLabel(option), width)));
    return lines;
  }
  const provider = selectedProvider(state);
  lines.push(`${ansi.bold}${provider.displayName}${ansi.reset} (${state.selectedBaseUrl ?? provider.baseUrl ?? "no base URL"})`);
  lines.push(...renderProviderLinks(provider));
  lines.push("");
  if (state.phase === "base_url") {
    lines.push(`Base URL [${provider.baseUrl ?? ""}]: ${clip(state.baseUrlInput, Math.max(8, width - 24))}`);
    lines.push(`${ansi.gray}Leave empty to use the displayed default. Ctrl+U clears input.${ansi.reset}`);
    return lines;
  }
  if (state.phase === "model") {
    const choices = [...provider.modelIds, "Custom model ID"];
    lines.push(...choices.map((choice, index) => renderChoiceLine(index, state.modelCursor, choice, width)));
    return lines;
  }
  if (state.phase === "custom_model") {
    lines.push(`Custom model ID: ${clip(state.customModelInput, Math.max(8, width - 20))}`);
    return lines;
  }
  const mask = state.apiKeyInput ? "*".repeat(Math.min(32, state.apiKeyInput.length)) : "";
  lines.push(`Model: ${state.selectedModel ?? provider.defaultModel}`);
  lines.push(`API key: ${mask}`);
  lines.push(`${ansi.gray}The raw key is submitted only to the encrypted local vault.${ansi.reset}`);
  return lines;
}

function renderChoiceLine(index: number, cursorIndex: number, label: string, width: number): string {
  const cursor = index === cursorIndex ? ">" : " ";
  const checked = "[ ]";
  return clip(`${cursor} ${checked} ${label}`, width);
}

function providerLabel(option: RichModelSetupProviderOption): string {
  return `${option.displayName} (${option.baseUrl ?? "no base URL"})`;
}

function modelSetupProviderOption(profile: RichModelSetupProfile): RichModelSetupProviderOption {
  return {
    id: profile.name,
    provider: profile.name,
    displayName: profile.displayName ?? profile.name,
    protocol: profile.protocol,
    baseUrl: profile.defaultBaseUrl,
    defaultModel: profile.defaultModel,
    modelIds: modelChoices(profile),
    apiKeyEnvNames: profile.apiKeyEnvNames,
    docsUrl: profile.docsUrl,
    apiKeysUrl: profile.apiKeysUrl,
    pricingUrl: profile.pricingUrl,
  };
}

function appendOpenAIResponsesModelSetupOption(options: RichModelSetupProviderOption[]): RichModelSetupProviderOption[] {
  const openAIOption = options.find((option) => option.provider === "openai");
  if (!openAIOption) {
    return options;
  }
  return [
    ...options,
    {
      ...openAIOption,
      id: "openai_responses",
      displayName: "OpenAI Responses API",
      protocol: "openai_responses",
    },
  ];
}

function renderProviderLinks(provider: RichModelSetupProviderOption): string[] {
  return [
    provider.apiKeysUrl ? `API keys: ${provider.apiKeysUrl}` : undefined,
    provider.docsUrl ? `Docs: ${provider.docsUrl}` : undefined,
    provider.pricingUrl ? `Pricing: ${provider.pricingUrl}` : undefined,
  ].filter((line): line is string => Boolean(line));
}

function selectedProvider(state: RichModelSetupState): RichModelSetupProviderOption {
  const index = state.selectedProviderIndex ?? state.providerCursor;
  const provider = state.providerOptions[index];
  if (!provider) {
    throw new Error("No model provider selected.");
  }
  return provider;
}

function requiresCustomBaseUrl(provider: RichModelSetupProviderOption): boolean {
  return provider.protocol === "openai_responses" || provider.provider === "openai_compatible" || provider.provider === "anthropic_compatible";
}

function modelChoices(profile: RichModelSetupProfile): string[] {
  return [...new Set([profile.defaultModel, ...(profile.modelIds ?? [])].filter(Boolean))];
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function wrapIndex(index: number, count: number): number {
  if (count <= 0) {
    return 0;
  }
  return ((index % count) + count) % count;
}
