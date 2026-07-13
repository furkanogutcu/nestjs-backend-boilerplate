export interface IRequeueOptions {
  id?: string;
  topic?: string;
  all: boolean;
  limit?: number;
  dryRun: boolean;
}

export function parseRequeueArgs(argv: string[]): IRequeueOptions {
  const valueOf = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);

    return index !== -1 ? argv[index + 1] : undefined;
  };

  const id = valueOf('--id');
  const topic = valueOf('--topic');
  const all = argv.includes('--all');
  const limit = valueOf('--limit');

  const selectorCount = [id !== undefined, topic !== undefined, all].filter(Boolean).length;

  if (selectorCount === 0) {
    throw new Error('one selector is required: --id <uuid> | --topic <name> | --all');
  }

  if (selectorCount > 1) {
    throw new Error('--id, --topic and --all are mutually exclusive');
  }

  if (limit !== undefined && !/^[1-9]\d*$/.test(limit)) {
    throw new Error('--limit must be a positive integer');
  }

  return { id, topic, all, limit: limit ? Number(limit) : undefined, dryRun: argv.includes('--dry-run') };
}
