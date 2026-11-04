import { describe, expect, it } from 'vitest';
import {
  chunk,
  createProviders,
  enrichItem,
  FakeEmbedder,
  FakeProvider,
  pseudonymise,
  type LlmProvider,
} from './index.js';

describe('enrichment', () => {
  it('parses provider JSON and restores child names', async () => {
    const seen: string[] = [];
    const llm: LlmProvider = {
      name: 't',
      model: 't',
      async complete({ messages }) {
        seen.push(messages[0]!.content);
        return 'Sure! {"source_lang":"ca","title":"Trip for [CHILD_1]","body":"[CHILD_1] goes to the park.","summary":"Sign the form for [CHILD_1] by 12 Nov","needs_action":true,"action_kind":"consent","deadline":"2026-11-12","confidence":0.92}';
      },
      async *stream() {},
    };
    const r = await enrichItem(
      llm,
      { title: 'Sortida de Maya', body: 'Maya anirà al parc.', section: 'circular' },
      'en',
      {
        childNames: ['Maya'],
      },
    );
    expect(seen[0]).not.toContain('Maya');
    expect(r.title).toBe('Trip for Maya');
    expect(r).toMatchObject({ needs_action: true, action_kind: 'consent', deadline: '2026-11-12' });
  });

  it('retries once on invalid output, then fails loudly', async () => {
    let calls = 0;
    const llm: LlmProvider = {
      name: 't',
      model: 't',
      complete: async () => (calls++, 'nope'),
      async *stream() {},
    };
    await expect(enrichItem(llm, { title: 'a', body: 'b', section: 'x' }, 'en')).rejects.toThrow(/invalid/);
    expect(calls).toBe(2);
  });

  it('fake provider classifies an authorisation with a deadline', async () => {
    const r = await enrichItem(
      new FakeProvider(),
      { title: 'Sortida', body: "Cal retornar l'autorització abans del 12/11/2026.", section: 'circular' },
      'en',
    );
    expect(r).toMatchObject({ needs_action: true, deadline: '2026-11-12', source_lang: 'ca' });
  });

  it('pseudonymise is case-insensitive and reversible', () => {
    const p = pseudonymise('MAYA i Leo', ['Maya', 'Leo']);
    expect(p.text).toBe('[CHILD_1] i [CHILD_2]');
    expect(p.restore('[CHILD_2] & [CHILD_1]')).toBe('Leo & Maya');
  });

  it('refuses non-EU regions and fake provider in production', () => {
    expect(() =>
      createProviders({ provider: 'bedrock', region: 'us-east-1', modelTranslate: 'a', modelChat: 'b' }),
    ).toThrow(/EU/);
    expect(() => createProviders({ provider: 'fake', nodeEnv: 'production' })).toThrow();
    expect(() => createProviders({ provider: 'anthropic', nodeEnv: 'production' })).toThrow();
  });

  it('chunks and embeds deterministically', async () => {
    expect(chunk('a. '.repeat(600), 100).every((c) => c.length <= 110)).toBe(true);
    const e = new FakeEmbedder();
    const [a, b] = await e.embed(['sortida al parc', 'sortida al parc'], 'document');
    expect(a).toEqual(b);
    expect(a).toHaveLength(1024);
  });
});
