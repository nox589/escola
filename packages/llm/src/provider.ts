import Anthropic from '@anthropic-ai/sdk';
import { AnthropicBedrock } from '@anthropic-ai/bedrock-sdk';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

/**
 * Provider abstraction (SPEC §4, §8.5). Golden rule 6: production must use an EU-region endpoint.
 * - 'bedrock': Anthropic models on AWS Bedrock in an EU region (default eu-west-3, Paris).
 * - 'anthropic': direct API, for local development only (refused in production).
 * - 'fake': deterministic, offline. Used by tests and by `pnpm dev` without keys.
 */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  complete(opts: {
    system: string;
    messages: ChatMessage[];
    maxTokens?: number;
    model?: string;
  }): Promise<string>;
  /** Streams text deltas (assistant chat). */
  stream(opts: { system: string; messages: ChatMessage[]; maxTokens?: number }): AsyncIterable<string>;
}

export interface Embedder {
  readonly dimensions: number;
  embed(texts: string[], kind: 'document' | 'query'): Promise<number[][]>;
}

/** Must match packages/db EMBEDDING_DIM. */
export const EMBEDDING_DIMENSIONS = 1024;

export interface LlmConfig {
  provider: 'bedrock' | 'anthropic' | 'fake';
  region?: string;
  apiKey?: string;
  modelTranslate?: string;
  modelChat?: string;
  embeddingModel?: string;
  nodeEnv?: string;
}

export function llmConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LlmConfig {
  return {
    provider: (env.LLM_PROVIDER as LlmConfig['provider']) ?? 'fake',
    region: env.LLM_REGION,
    apiKey: env.LLM_API_KEY,
    modelTranslate: env.LLM_MODEL_TRANSLATE,
    modelChat: env.LLM_MODEL_CHAT,
    embeddingModel: env.EMBEDDING_MODEL,
    nodeEnv: env.NODE_ENV,
  };
}

const EU_REGION = /^eu-/;

class AnthropicLike implements LlmProvider {
  constructor(
    readonly name: string,
    private readonly client: Anthropic | AnthropicBedrock,
    readonly model: string,
  ) {}

  async complete({ system, messages, maxTokens = 2000, model }: Parameters<LlmProvider['complete']>[0]) {
    const res = await (this.client as Anthropic).messages.create({
      model: model ?? this.model,
      max_tokens: maxTokens,
      system,
      messages,
    });
    return res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  }

  async *stream({ system, messages, maxTokens = 1500 }: Parameters<LlmProvider['stream']>[0]) {
    const s = (this.client as Anthropic).messages.stream({
      model: this.model,
      max_tokens: maxTokens,
      system,
      messages,
    });
    for await (const ev of s) {
      if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') yield ev.delta.text;
    }
  }
}

export function createProviders(cfg: LlmConfig): {
  translate: LlmProvider;
  chat: LlmProvider;
  embedder: Embedder;
} {
  if (cfg.provider === 'fake') {
    if (cfg.nodeEnv === 'production') throw new Error('Fake LLM provider is not allowed in production');
    const fake = new FakeProvider();
    return { translate: fake, chat: fake, embedder: new FakeEmbedder() };
  }
  if (cfg.provider === 'anthropic') {
    if (cfg.nodeEnv === 'production') throw new Error('Direct API is dev-only; use bedrock in an EU region');
    const client = new Anthropic({ apiKey: cfg.apiKey });
    const translate = new AnthropicLike('anthropic', client, cfg.modelTranslate ?? 'claude-haiku-5-5');
    const chat = new AnthropicLike('anthropic', client, cfg.modelChat ?? 'claude-sonnet-5-5');
    return { translate, chat, embedder: new FakeEmbedder() };
  }
  const region = cfg.region ?? 'eu-west-3';
  if (!EU_REGION.test(region)) throw new Error(`LLM_REGION must be an EU region, got ${region}`);
  if (!cfg.modelTranslate || !cfg.modelChat)
    throw new Error('LLM_MODEL_TRANSLATE and LLM_MODEL_CHAT are required');
  const client = new AnthropicBedrock({ awsRegion: region });
  return {
    translate: new AnthropicLike('bedrock', client, cfg.modelTranslate),
    chat: new AnthropicLike('bedrock', client, cfg.modelChat),
    embedder: new BedrockEmbedder(region, cfg.embeddingModel ?? 'cohere.embed-multilingual-v3'),
  };
}

/** Cohere multilingual v3 on Bedrock EU: 1024 dims, strong on Catalan/Spanish. */
export class BedrockEmbedder implements Embedder {
  readonly dimensions = EMBEDDING_DIMENSIONS;
  readonly #client: BedrockRuntimeClient;
  constructor(
    region: string,
    private readonly modelId: string,
  ) {
    this.#client = new BedrockRuntimeClient({ region });
  }
  async embed(texts: string[], kind: 'document' | 'query') {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 64) {
      const res = await this.#client.send(
        new InvokeModelCommand({
          modelId: this.modelId,
          contentType: 'application/json',
          body: JSON.stringify({
            texts: texts.slice(i, i + 64).map((t) => t.slice(0, 2000)),
            input_type: kind === 'query' ? 'search_query' : 'search_document',
          }),
        }),
      );
      out.push(...(JSON.parse(new TextDecoder().decode(res.body)) as { embeddings: number[][] }).embeddings);
    }
    return out;
  }
}

/** Deterministic hashed bag-of-words. Good enough for tests and offline dev search. */
export class FakeEmbedder implements Embedder {
  readonly dimensions = EMBEDDING_DIMENSIONS;
  async embed(texts: string[], _kind?: 'document' | 'query') {
    return texts.map((t) => {
      const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
      for (const w of t
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .match(/[a-z0-9]{3,}/g) ?? []) {
        let h = 2166136261;
        for (let i = 0; i < w.length; i++) h = Math.imul(h ^ w.charCodeAt(i), 16777619);
        v[Math.abs(h) % EMBEDDING_DIMENSIONS]! += 1;
      }
      const n = Math.hypot(...v) || 1;
      return v.map((x) => x / n);
    });
  }
}

/**
 * Offline provider. Responds to the enrichment prompt with a plausible JSON object and to chat
 * with a plain answer built from the context it was given. Never used in production.
 */
export class FakeProvider implements LlmProvider {
  readonly name = 'fake';
  readonly model = 'fake-1';
  async complete({ messages }: Parameters<LlmProvider['complete']>[0]) {
    const last = messages[messages.length - 1]?.content ?? '';
    const input = /<item>([\s\S]*?)<\/item>/.exec(last)?.[1];
    if (input) {
      const lang = /<target_lang>(\w+)<\/target_lang>/.exec(last)?.[1] ?? 'en';
      const title = /<title>([\s\S]*?)<\/title>/.exec(input)?.[1]?.trim() ?? '';
      const body = /<body>([\s\S]*?)<\/body>/.exec(input)?.[1]?.trim() ?? '';
      const needs = /(autoritzaci|autorizaci|cal retornar|signad|firmad|abans del|antes del|inscripci)/i.test(
        body,
      );
      const deadline = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(body);
      return JSON.stringify({
        source_lang: /\b(els|les|amb|per|cal|famílies|dels|l'|d')/i.test(`${title} ${body}`)
          ? 'ca'
          : /\b(los|las|para|con|familias)\b/i.test(body)
            ? 'es'
            : 'ca',
        title: `[${lang}] ${title}`,
        body: `[${lang}] ${body}`,
        summary: `[${lang}] ${title}`.slice(0, 140),
        needs_action: needs,
        action_kind: needs ? 'consent' : null,
        deadline: deadline
          ? `${deadline[3]}-${deadline[2]!.padStart(2, '0')}-${deadline[1]!.padStart(2, '0')}`
          : null,
        confidence: needs ? 0.8 : 0.9,
      });
    }
    // Offline chat: list open actions and related items from the context, with citations.
    const actions = /<open_actions>\n([\s\S]*?)\n<\/open_actions>/.exec(last)?.[1]?.trim();
    const items = [
      ...new Map(
        [...last.matchAll(/<item id="([^"]+)"[^>]*title="([^"]*)"/g)].map((m) => [m[1], m] as const),
      ).values(),
    ].slice(0, 3);
    const parts = ['(Offline demo answer, no AI model configured.)'];
    if (actions && actions !== '(none)') parts.push(`Open actions:\n${actions}`);
    if (items.length)
      parts.push(`Related messages:\n${items.map((m) => `- ${m[2]} [item:${m[1]}]`).join('\n')}`);
    if (parts.length === 1)
      parts.push("I don't know. I couldn't find anything about that in your school messages.");
    return parts.join('\n\n');
  }
  async *stream(opts: Parameters<LlmProvider['stream']>[0]) {
    const text = await this.complete(opts);
    for (const w of text.split(/(?<=\s)/)) yield w;
  }
}
