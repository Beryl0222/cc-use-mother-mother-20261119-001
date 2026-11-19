import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { DomainError } from '../domain/types.js';
import { IntelligenceService } from '../workflow/intelligence-service.js';

const BODY_LIMIT = 1_000_000;

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > BODY_LIMIT) throw new DomainError('request_too_large', '请求正文超过 1 MB', 413);
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new DomainError('invalid_json', '请求正文不是有效 JSON');
  }
}

function send(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  response.end(body);
}

function routeId(pathname: string, prefix: string, suffix = ''): string | null {
  if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) return null;
  const raw = pathname.slice(prefix.length, pathname.length - suffix.length || undefined);
  if (!raw || raw.includes('/')) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new DomainError('invalid_path', '路径标识不是有效编码');
  }
}

async function dispatch(request: IncomingMessage, response: ServerResponse, service: IntelligenceService): Promise<void> {
  const base = `http://${request.headers.host ?? '127.0.0.1'}`;
  const url = new URL(request.url ?? '/', base);
  const method = request.method ?? 'GET';
  if (method === 'GET' && url.pathname === '/health') return send(response, 200, service.health());

  if (method === 'POST' && url.pathname === '/v1/documents') {
    return send(response, 201, service.importDocument(await readJson(request)));
  }
  if (method === 'GET' && url.pathname === '/v1/documents') {
    const limit = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : 50;
    const offset = url.searchParams.has('offset') ? Number(url.searchParams.get('offset')) : 0;
    return send(response, 200, service.documentSummaries(limit, offset));
  }
  const documentId = routeId(url.pathname, '/v1/documents/');
  if (method === 'GET' && documentId) return send(response, 200, service.document(documentId));

  if (method === 'GET' && url.pathname === '/v1/observations') {
    return send(response, 200, service.listObservations(url.searchParams.get('decision')));
  }
  if (method === 'GET' && url.pathname === '/v1/review-queue') {
    const limit = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : 100;
    const offset = url.searchParams.has('offset') ? Number(url.searchParams.get('offset')) : 0;
    return send(response, 200, service.reviewQueue(limit, offset));
  }
  const reviewId = routeId(url.pathname, '/v1/observations/', '/review');
  if (method === 'POST' && reviewId) return send(response, 200, service.review(reviewId, await readJson(request) as never));
  const candidateId = routeId(url.pathname, '/v1/observations/', '/candidate');
  if (method === 'PATCH' && candidateId) return send(response, 200, service.correctCandidate(candidateId, await readJson(request) as never));
  const contextId = routeId(url.pathname, '/v1/observations/', '/context');
  if (method === 'GET' && contextId) {
    const radiusValue = url.searchParams.get('radius');
    const radius = radiusValue === null ? undefined : Number(radiusValue);
    return send(response, 200, service.evidenceContext(contextId, radius));
  }
  const historyId = routeId(url.pathname, '/v1/observations/', '/history');
  if (method === 'GET' && historyId) return send(response, 200, service.reviews.history(historyId));

  if (method === 'GET' && url.pathname === '/v1/conflicts') return send(response, 200, service.conflicts());
  if (method === 'POST' && url.pathname === '/v1/briefs') {
    const body = await readJson(request) as Record<string, unknown>;
    if (body.topic !== undefined && typeof body.topic !== 'string') throw new DomainError('invalid_topic', 'topic 必须是文本');
    if (body.since !== undefined && typeof body.since !== 'string') throw new DomainError('invalid_since', 'since 必须是日期文本');
    const query: { topic?: string; since?: string } = {};
    if (typeof body.topic === 'string') query.topic = body.topic;
    if (typeof body.since === 'string') query.since = body.since;
    const brief = service.createBrief(query);
    return send(response, 201, { snapshot: brief, markdown: service.brief(brief.id).markdown });
  }
  const briefId = routeId(url.pathname, '/v1/briefs/');
  if (method === 'GET' && briefId) return send(response, 200, service.brief(briefId));

  send(response, 404, { error: 'not_found', message: '不存在该接口' });
}

export function createHttpServer(service: IntelligenceService): Server {
  return createServer((request, response) => {
    void dispatch(request, response, service).catch((error: unknown) => {
      if (error instanceof DomainError) return send(response, error.status, { error: error.code, message: error.message });
      const message = error instanceof Error ? error.message : '未知服务错误';
      return send(response, 500, { error: 'internal_error', message });
    });
  });
}

export function listen(server: Server, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
}

export function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

export function replyJson(response: ServerResponse, status: number, value: unknown): void {
  send(response, status, value);
}
