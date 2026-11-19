import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { createHttpServer, listen, closeServer } from './http/server.js';
import { createIntelligence } from './workflow/intelligence-service.js';

async function demo(fixturePath: string): Promise<void> {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as {
    documents: Array<Record<string, unknown>>;
    acceptAll?: boolean;
  };
  const directory = await mkdtemp(join(tmpdir(), 'cn-compute-intelligence-'));
  const service = createIntelligence(join(directory, 'demo.sqlite'));
  try {
    for (const document of fixture.documents) service.importDocument(document);
    if (fixture.acceptAll) {
      for (const observation of service.listObservations('pending')) {
        service.review(observation.id, {
          expectedRevision: observation.reviewRevision,
          decision: 'accepted',
          reviewer: '本地演练',
          note: '仅用于验证演练链路',
        });
      }
    }
    const brief = service.createBrief({ topic: '算力' });
    process.stdout.write(`${JSON.stringify({
      documents: fixture.documents.length,
      pending: service.health().pendingObservations,
      conflicts: brief.unresolved.length,
      publishedFacts: brief.items.length,
      markdown: service.brief(brief.id).markdown,
    }, null, 2)}\n`);
  } finally {
    service.close();
    await rm(directory, { recursive: true, force: true });
  }
}

async function serve(): Promise<void> {
  const service = createIntelligence(process.env.INTELLIGENCE_DB ?? './var/intelligence.sqlite');
  const server = createHttpServer(service);
  const host = process.env.HOST ?? '127.0.0.1';
  const port = Number(process.env.PORT ?? 8090);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('PORT 必须是 1 至 65535 的整数');
  await listen(server, host, port);
  process.stdout.write(`服务已监听 http://${host}:${port}\n`);
  const stop = async () => {
    await closeServer(server);
    service.close();
  };
  process.once('SIGINT', () => void stop().then(() => process.exit(0)));
  process.once('SIGTERM', () => void stop().then(() => process.exit(0)));
}

const [command, argument] = process.argv.slice(2);
if (command === 'demo' && argument) await demo(argument);
else if (command === 'serve') await serve();
else {
  process.stderr.write('用法：node dist/cli.js demo <本地样本.json> | serve\n');
  process.exitCode = 2;
}
