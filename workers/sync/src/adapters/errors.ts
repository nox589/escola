export class SelectorNotDiscoveredError extends Error {
  constructor(readonly key: string) {
    super(`Selector '${key}' is TO_BE_DISCOVERED. See docs/SELECTOR_DISCOVERY.md; do not guess it.`);
    this.name = 'SelectorNotDiscoveredError';
  }
}

export class ParserDriftError extends Error {
  constructor(
    message: string,
    readonly section?: string,
  ) {
    super(message);
    this.name = 'ParserDriftError';
  }
}

export class WriteNotConfirmedError extends Error {
  constructor() {
    super('Refusing to write: no parent confirmation (previewHash) supplied');
    this.name = 'WriteNotConfirmedError';
  }
}
