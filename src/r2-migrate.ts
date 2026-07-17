/**
 * R2 bucket data migration using the S3-compatible API via aws4fetch.
 *
 * aws4fetch is a zero-dependency AWS Signature V4 fetch wrapper that runs
 * natively in Cloudflare Workers.  We use it to:
 *   1. ListObjectsV2 on the source bucket
 *   2. GET each object from source, pipe the body stream directly into a PUT
 *      on the destination — no buffering into memory.
 *
 * Parallelism is tuned for Worker CPU/memory limits (default 6 concurrent
 * transfers).
 */

import { AwsClient } from 'aws4fetch';

// ── Types ──────────────────────────────────────────────────────────────────

export interface R2S3Credentials {
  accessKeyId: string;
  secretAccessKey: string;
}

export interface R2MigrationResult {
  bucket: string;
  totalObjects: number;
  copied: number;
  failed: number;
  skipped: number;
  elapsedMs: number;
  errors: string[];
}

type LogFn = (message: string) => void;

// ── Constants ──────────────────────────────────────────────────────────────

/** Number of objects transferred in parallel per batch. */
const R2_COPY_CONCURRENCY = 6;

/** Max keys returned per ListObjectsV2 request (S3 max is 1000). */
const LIST_PAGE_SIZE = 1000;

// ── Helpers ────────────────────────────────────────────────────────────────

function s3Endpoint(accountId: string): string {
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

function makeClient(accountId: string, creds: R2S3Credentials): AwsClient {
  return new AwsClient({
    accessKeyId: creds.accessKeyId,
    secretAccessKey: creds.secretAccessKey,
    service: 's3',
    region: 'auto',
  });
}

// ── S3 list objects ────────────────────────────────────────────────────────

interface S3Object {
  key: string;
  size: number;
}

/**
 * Lists all objects in an R2 bucket using the S3 ListObjectsV2 API.
 * Handles pagination automatically.
 */
async function listAllObjects(
  client: AwsClient,
  endpoint: string,
  bucket: string,
  log: LogFn,
): Promise<S3Object[]> {
  const objects: S3Object[] = [];
  let continuationToken: string | undefined;
  let page = 0;

  do {
    page++;
    const params = new URLSearchParams({
      'list-type': '2',
      'max-keys': String(LIST_PAGE_SIZE),
    });
    if (continuationToken) {
      params.set('continuation-token', continuationToken);
    }

    const url = `${endpoint}/${bucket}?${params.toString()}`;
    const res = await client.fetch(url, { method: 'GET' });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`ListObjectsV2 failed (${res.status}): ${body.slice(0, 200)}`);
    }

    const xml = await res.text();

    // Parse <Contents> entries — minimal XML parsing without a dependency.
    // Each <Contents> block contains <Key> and <Size>.
    const contentsRegex = /<Contents>([\s\S]*?)<\/Contents>/g;
    let match: RegExpExecArray | null;
    while ((match = contentsRegex.exec(xml)) !== null) {
      const block = match[1];
      const keyMatch = /<Key>(.*?)<\/Key>/.exec(block);
      const sizeMatch = /<Size>(\d+)<\/Size>/.exec(block);
      if (keyMatch) {
        objects.push({
          key: decodeXmlEntities(keyMatch[1]),
          size: sizeMatch ? parseInt(sizeMatch[1], 10) : 0,
        });
      }
    }

    // Check for truncation
    const isTruncated = /<IsTruncated>true<\/IsTruncated>/i.test(xml);
    if (isTruncated) {
      const tokenMatch = /<NextContinuationToken>(.*?)<\/NextContinuationToken>/.exec(xml);
      continuationToken = tokenMatch ? decodeXmlEntities(tokenMatch[1]) : undefined;
    } else {
      continuationToken = undefined;
    }

    if (page % 5 === 0 || !continuationToken) {
      log(`    📦 Listed ${objects.length} objects so far (page ${page})...`);
    }
  } while (continuationToken);

  return objects;
}

/** Decode common XML entities (&amp; &lt; &gt; &quot; &apos;). */
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

// ── Single-object copy ─────────────────────────────────────────────────────

/**
 * Copies a single object from source → dest by streaming the body.
 * Uses GET on source, pipes res.body into PUT on dest.
 * Preserves Content-Type if the source provides it.
 */
async function copyObject(
  sourceClient: AwsClient,
  sourceEndpoint: string,
  destClient: AwsClient,
  destEndpoint: string,
  bucket: string,
  key: string,
): Promise<void> {
  // URL-encode the key for path segments (preserve `/` for nested keys)
  const encodedKey = key.split('/').map(encodeURIComponent).join('/');

  const getUrl = `${sourceEndpoint}/${bucket}/${encodedKey}`;
  const getRes = await sourceClient.fetch(getUrl, { method: 'GET' });
  if (!getRes.ok) {
    const errBody = await getRes.text();
    throw new Error(`GET ${key} failed (${getRes.status}): ${errBody.slice(0, 200)}`);
  }

  const putUrl = `${destEndpoint}/${bucket}/${encodedKey}`;
  const headers: Record<string, string> = {};
  const ct = getRes.headers.get('content-type');
  if (ct) headers['content-type'] = ct;
  // Pass content-length if available so R2 can validate / avoid chunked
  const cl = getRes.headers.get('content-length');
  if (cl) headers['content-length'] = cl;

  const putRes = await destClient.fetch(putUrl, {
    method: 'PUT',
    headers,
    body: getRes.body, // stream directly — no buffering
  });
  if (!putRes.ok) {
    const errBody = await putRes.text();
    throw new Error(`PUT ${key} failed (${putRes.status}): ${errBody.slice(0, 200)}`);
  }
  // Consume body to release connection
  await putRes.text();
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Migrates all objects in a single R2 bucket from source account → dest account.
 *
 * @param sourceAccountId - Source Cloudflare account ID
 * @param destAccountId   - Destination Cloudflare account ID
 * @param sourceCreds     - S3 credentials for source R2
 * @param destCreds       - S3 credentials for destination R2
 * @param bucketName      - Name of the bucket (must exist on both accounts)
 * @param log             - Logging callback (receives progress messages)
 * @param concurrency     - Number of parallel object transfers (default 6)
 */
export async function migrateR2BucketData(
  sourceAccountId: string,
  destAccountId: string,
  sourceCreds: R2S3Credentials,
  destCreds: R2S3Credentials,
  bucketName: string,
  log: LogFn,
  concurrency: number = R2_COPY_CONCURRENCY,
): Promise<R2MigrationResult> {
  const startTime = Date.now();
  const result: R2MigrationResult = {
    bucket: bucketName,
    totalObjects: 0,
    copied: 0,
    failed: 0,
    skipped: 0,
    elapsedMs: 0,
    errors: [],
  };

  const sourceEndpoint = s3Endpoint(sourceAccountId);
  const destEndpoint = s3Endpoint(destAccountId);
  const sourceClient = makeClient(sourceAccountId, sourceCreds);
  const destClient = makeClient(destAccountId, destCreds);

  // 1. List all objects in source bucket
  log(`    ⏳ Listing objects in "${bucketName}"...`);
  const objects = await listAllObjects(sourceClient, sourceEndpoint, bucketName, log);
  result.totalObjects = objects.length;
  log(`    ✓ Found ${objects.length} objects in "${bucketName}"`);

  if (objects.length === 0) {
    result.elapsedMs = Date.now() - startTime;
    return result;
  }

  // 2. Copy objects in parallel batches
  log(`    ⏳ Copying ${objects.length} objects (${concurrency} parallel)...`);

  for (let i = 0; i < objects.length; i += concurrency) {
    const batch = objects.slice(i, i + concurrency);
    const batchNum = Math.floor(i / concurrency) + 1;
    const totalBatches = Math.ceil(objects.length / concurrency);

    const results = await Promise.allSettled(
      batch.map(obj =>
        copyObject(sourceClient, sourceEndpoint, destClient, destEndpoint, bucketName, obj.key)
      ),
    );

    for (let j = 0; j < results.length; j++) {
      if (results[j].status === 'fulfilled') {
        result.copied++;
      } else {
        result.failed++;
        const reason = (results[j] as PromiseRejectedResult).reason;
        const errMsg = reason instanceof Error ? reason.message : String(reason);
        result.errors.push(`${batch[j].key}: ${errMsg}`);
        log(`    ⚠️ Failed to copy "${batch[j].key}": ${errMsg}`);
      }
    }

    // Log progress periodically (every batch)
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`    📦 "${bucketName}": ${result.copied + result.failed}/${objects.length} objects (${result.copied} ok, ${result.failed} failed) [${elapsed}s]`);
  }

  result.elapsedMs = Date.now() - startTime;
  const totalElapsed = (result.elapsedMs / 1000).toFixed(1);
  log(`    ✓ Copied ${result.copied}/${objects.length} objects in "${bucketName}"${result.failed > 0 ? ` (${result.failed} failed)` : ''} in ${totalElapsed}s`);

  return result;
}
