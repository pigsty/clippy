import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';
import QRCode from 'qrcode';
import { CONTENT_DIR, listVideos, getCategorySummaries, extractTags, Video } from './videos';
import {
  AnalyticsConfig,
  generateIndexHTML,
  generateCategoryHTML,
  generateVideoHTML,
  VideoNavigationData,
} from './templates';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront';
import { computeInvalidationPaths } from './publishInvalidation';
import { lookup as mimeLookup } from 'mime-types';

export const STATIC_DIR = path.join(CONTENT_DIR, 'static');
export const PREVIEW_DIR = path.join(CONTENT_DIR, 'static-preview');
const execAsync = promisify(exec);

interface GenerateOptions {
  forPreview?: boolean;
}

interface ShareCardData {
  label: string;
  url: string;
  qrCodeDataUrl: string;
}

interface PublishManifest {
  version: 1;
  files: Record<string, string>;
}

interface S3SyncResult {
  changed: boolean;
  changedKeys: string[];
  allKnownKeys: string[];
}

const PUBLISH_MANIFEST_KEY = '.clippy-manifest.json';

function buildVideoNavigation(
  videos: Video[],
  categories: ReturnType<typeof getCategorySummaries>,
  currentVideoSlug: string,
  basePath: string
): VideoNavigationData {
  const index = videos.findIndex(video => video.slug === currentVideoSlug);
  const overall = {
    previous: index > 0 ? `${basePath}/video/${videos[index - 1].slug}/` : undefined,
    next: index >= 0 && index < videos.length - 1 ? `${basePath}/video/${videos[index + 1].slug}/` : undefined,
    back: `${basePath}/`,
  };

  const byCategory: VideoNavigationData['byCategory'] = {};
  for (const category of categories) {
    const categoryVideos = videos.filter(video => extractTags(video.meta.title).includes(category.tag));
    const categoryIndex = categoryVideos.findIndex(video => video.slug === currentVideoSlug);
    if (categoryIndex === -1) {
      continue;
    }

    byCategory[category.label] = {
      previous: categoryIndex > 0
        ? `${basePath}/video/${categoryVideos[categoryIndex - 1].slug}/?category=${encodeURIComponent(category.label)}`
        : undefined,
      next: categoryIndex < categoryVideos.length - 1
        ? `${basePath}/video/${categoryVideos[categoryIndex + 1].slug}/?category=${encodeURIComponent(category.label)}`
        : undefined,
      back: `${basePath}/category/${category.label}/`,
    };
  }

  return { overall, byCategory };
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const item of fs.readdirSync(src)) {
    const s = path.join(src, item);
    const d = path.join(dest, item);
    fs.statSync(s).isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d);
  }
}

function getAllFiles(dir: string): string[] {
  const result: string[] = [];
  for (const item of fs.readdirSync(dir)) {
    const full = path.join(dir, item);
    fs.statSync(full).isDirectory()
      ? result.push(...getAllFiles(full))
      : result.push(full);
  }
  return result;
}

function normalizeShareBaseUrl(url?: string): string | undefined {
  if (!url) {
    return undefined;
  }

  return url.trim().replace(/\/$/, '');
}

async function buildShareCard(label: string, url?: string): Promise<ShareCardData | undefined> {
  if (!url) {
    return undefined;
  }

  return {
    label,
    url,
    qrCodeDataUrl: await QRCode.toDataURL(url, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 160,
    }),
  };
}

function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

async function bodyToString(body: unknown): Promise<string> {
  if (body && typeof body === 'object' && 'transformToString' in body) {
    const transformToString = (body as { transformToString: () => Promise<string> }).transformToString;
    return transformToString();
  }

  if (body instanceof Uint8Array) {
    return Buffer.from(body).toString('utf-8');
  }

  throw new Error('Unsupported S3 body type for manifest');
}

async function loadManifest(client: S3Client, bucket: string): Promise<PublishManifest> {
  try {
    const res = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: PUBLISH_MANIFEST_KEY,
      })
    );

    if (!res.Body) {
      return { version: 1, files: {} };
    }

    const text = await bodyToString(res.Body);
    const parsed = JSON.parse(text) as Partial<PublishManifest>;
    if (parsed.version !== 1 || !parsed.files || typeof parsed.files !== 'object') {
      console.log('Existing publish manifest is invalid, doing full sync');
      return { version: 1, files: {} };
    }

    return { version: 1, files: parsed.files as Record<string, string> };
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'NoSuchKey') {
      return { version: 1, files: {} };
    }
    throw err;
  }
}

async function uploadManifest(client: S3Client, bucket: string, manifest: PublishManifest): Promise<void> {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: PUBLISH_MANIFEST_KEY,
      Body: JSON.stringify(manifest),
      ContentType: 'application/json',
    })
  );
}

async function deleteKeys(client: S3Client, bucket: string, keys: string[]): Promise<void> {
  if (keys.length === 0) {
    return;
  }

  const batchSize = 1000;
  for (let i = 0; i < keys.length; i += batchSize) {
    const batch = keys.slice(i, i + batchSize);
    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: batch.map(Key => ({ Key })),
          Quiet: true,
        },
      })
    );
  }
}

async function uploadToS3(): Promise<S3SyncResult> {
  const bucket = process.env.S3_BUCKET;
  const region = process.env.S3_REGION || 'us-east-1';

  if (!bucket) {
    console.log('S3_BUCKET not configured — skipping upload');
    return { changed: false, changedKeys: [], allKnownKeys: [] };
  }

  const client = new S3Client({ region });
  const files = getAllFiles(STATIC_DIR);
  const nextFiles: Record<string, string> = {};

  for (const file of files) {
    const key = path.relative(STATIC_DIR, file).replace(/\\/g, '/');
    const body = fs.readFileSync(file);
    nextFiles[key] = sha256Hex(body);
  }

  const previousManifest = await loadManifest(client, bucket);
  const previousFiles = previousManifest.files;
  const keysToUpload = Object.keys(nextFiles).filter(key => previousFiles[key] !== nextFiles[key]);
  const keysToDelete = Object.keys(previousFiles).filter(key => !(key in nextFiles));
  const allKnownKeys = Array.from(new Set([...Object.keys(previousFiles), ...Object.keys(nextFiles)]));

  for (const key of keysToUpload) {
    const file = path.join(STATIC_DIR, key);
    const contentType = mimeLookup(file) || 'application/octet-stream';
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: fs.readFileSync(file),
        ContentType: contentType,
      })
    );
    console.log(`  uploaded: ${key}`);
  }

  await deleteKeys(client, bucket, keysToDelete);
  for (const key of keysToDelete) {
    console.log(`  deleted: ${key}`);
  }

  const nextManifest: PublishManifest = {
    version: 1,
    files: nextFiles,
  };
  await uploadManifest(client, bucket, nextManifest);

  const changed = keysToUpload.length > 0 || keysToDelete.length > 0;
  if (changed) {
    console.log(
      `Published delta to s3://${bucket} (${keysToUpload.length} uploaded, ${keysToDelete.length} deleted, ${files.length} total keys)`
    );
  } else {
    console.log(`No S3 changes detected for s3://${bucket}`);
  }

  return {
    changed,
    changedKeys: Array.from(new Set([...keysToUpload, ...keysToDelete])).sort((a, b) => a.localeCompare(b)),
    allKnownKeys,
  };
}

function distributionIdFromArn(arn: string): string {
  const match = arn.trim().match(/:distribution\/([A-Za-z0-9_-]+)$/);
  if (!match) {
    throw new Error('CF_DISTRIBUTION_ARN must be a valid CloudFront distribution ARN');
  }
  return match[1];
}

async function invalidateCloudFrontIfConfigured(syncResult: S3SyncResult): Promise<void> {
  if (!syncResult.changed) {
    return;
  }

  const distributionArn = process.env.CF_DISTRIBUTION_ARN;
  if (!distributionArn) {
    return;
  }

  const distributionId = distributionIdFromArn(distributionArn);
  const client = new CloudFrontClient({ region: 'us-east-1' });
  const callerReference = `clippy-${Date.now()}`;
  const invalidationPaths = computeInvalidationPaths(syncResult.changedKeys, syncResult.allKnownKeys);

  await client.send(
    new CreateInvalidationCommand({
      DistributionId: distributionId,
      InvalidationBatch: {
        CallerReference: callerReference,
        Paths: {
          Quantity: invalidationPaths.length,
          Items: invalidationPaths,
        },
      },
    })
  );

  console.log(
    `CloudFront invalidation requested for distribution ${distributionId} (${invalidationPaths.length} path${invalidationPaths.length === 1 ? '' : 's'})`
  );
}

async function generateAvatar(srcPath: string, destPath: string): Promise<void> {
  await execAsync(
    `ffmpeg -i "${srcPath}" -vf "scale=500:500:force_original_aspect_ratio=increase,crop=500:500" -frames:v 1 -q:v 2 "${destPath}" -y`
  );
}

function applySubtitleLinePosition(vttContent: string): string {
  const normalized = vttContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const timingLinePattern = /^(\d{2}:)?\d{2}:\d{2}\.\d{3}\s+-->\s+(\d{2}:)?\d{2}:\d{2}\.\d{3}(\s+.*)?$/;

  return normalized
    .split('\n')
    .map(rawLine => {
      const line = rawLine.trim();
      if (!timingLinePattern.test(line)) {
        return rawLine;
      }

      const withoutPositioning = line
        .replace(/\s+line:\s*[-\d.]+%?(?:,[a-z]+)?/gi, '')
        .replace(/\s+position:\s*[-\d.]+%?(?:,[a-z]+)?/gi, '')
        .replace(/\s+align:\s*[a-z]+/gi, '');

      return `${withoutPositioning} line:75% position:50% align:middle`;
    })
    .join('\n');
}

export async function generateStaticSite(options: GenerateOptions = {}): Promise<void> {
  const forPreview = options.forPreview === true;
  const basePath = forPreview ? '/preview' : '';
  const fallbackShareBaseUrl = forPreview ? 'http://localhost:3000/preview' : 'http://localhost:3000';
  const outputDir = forPreview ? PREVIEW_DIR : STATIC_DIR;

  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const allVideos = listVideos();
  const published = allVideos.filter(v => v.meta.published);
  const categories = getCategorySummaries(published);
  const shareBaseUrl = normalizeShareBaseUrl(
    process.env.SHARE_URL || process.env.PUBLIC_SITE_URL || fallbackShareBaseUrl
  );
  const gaMeasurementId = (process.env.GA_MEASUREMENT_ID || '').trim();
  const analytics: AnalyticsConfig | undefined = gaMeasurementId
    ? { measurementId: gaMeasurementId }
    : undefined;
  const siteShareCard = await buildShareCard('Share profile', shareBaseUrl);

  const bioPath = path.join(CONTENT_DIR, 'bio.txt');
  const bio = fs.existsSync(bioPath) ? fs.readFileSync(bioPath, 'utf-8').trim() : '';

  const avatarSrc = path.join(CONTENT_DIR, 'avatar.jpg');
  const hasAvatar = fs.existsSync(avatarSrc);
  if (hasAvatar) {
    const avatarDest = path.join(outputDir, 'avatar.jpg');
    await generateAvatar(avatarSrc, avatarDest);
  }

  // Index
  writeFile(
    path.join(outputDir, 'index.html'),
    generateIndexHTML(published, categories, bio, hasAvatar, basePath, siteShareCard, analytics)
  );

  // Category pages
  for (const category of categories) {
    const catVideos = published.filter(video => extractTags(video.meta.title).includes(category.tag));
    const catDir = path.join(outputDir, 'category', category.label);
    fs.mkdirSync(catDir, { recursive: true });
    writeFile(
      path.join(catDir, 'index.html'),
      generateCategoryHTML(catVideos, categories, bio, hasAvatar, category.tag, basePath, siteShareCard, analytics)
    );
  }

  if (forPreview) {
    // Preview points to existing content without duplicating video assets.
    const previewVideoRoot = path.join(outputDir, 'video');
    fs.mkdirSync(previewVideoRoot, { recursive: true });
    for (const video of published) {
      const videoStaticDir = path.join(outputDir, 'video', video.slug);
      const videoContentDir = path.join(CONTENT_DIR, 'videos', video.slug);
      const videoShareCard = await buildShareCard(
        'Share video',
        shareBaseUrl ? `${shareBaseUrl}/video/${video.slug}/` : undefined
      );
      const navigation = buildVideoNavigation(published, categories, video.slug, basePath);
      fs.mkdirSync(videoStaticDir, { recursive: true });

      for (const thumb of video.thumbs) {
        fs.symlinkSync(
          path.join(videoContentDir, thumb),
          path.join(videoStaticDir, thumb)
        );
      }

      const subtitlesSrc = path.join(videoContentDir, video.meta.subtitlesFile || 'subtitles.vtt');
      if (fs.existsSync(subtitlesSrc)) {
        const subtitleName = path.basename(subtitlesSrc);
        const subtitleDest = path.join(videoStaticDir, subtitleName);
        if (subtitleName.endsWith('.vtt')) {
          const rawVtt = fs.readFileSync(subtitlesSrc, 'utf-8');
          fs.writeFileSync(subtitleDest, applySubtitleLinePosition(rawVtt), 'utf-8');
        } else {
          fs.symlinkSync(subtitlesSrc, subtitleDest);
        }
      }

      const hlsSrc = path.join(videoContentDir, 'hls');
      if (fs.existsSync(hlsSrc)) {
        fs.symlinkSync(hlsSrc, path.join(videoStaticDir, 'hls'));
      }

      writeFile(
        path.join(videoStaticDir, 'index.html'),
        generateVideoHTML(video, categories, basePath, videoShareCard, navigation, analytics)
      );
    }
    return;
  }

  // Publish build copies all video assets into static output.
  for (const video of published) {
    const videoContentDir = path.join(CONTENT_DIR, 'videos', video.slug);
    const videoStaticDir = path.join(outputDir, 'video', video.slug);
    const videoShareCard = await buildShareCard(
      'Share video',
      shareBaseUrl ? `${shareBaseUrl}/video/${video.slug}/` : undefined
    );
    const navigation = buildVideoNavigation(published, categories, video.slug, basePath);
    fs.mkdirSync(videoStaticDir, { recursive: true });

    // Copy media assets and normalize subtitle line position for publish output.
    const assets = fs.readdirSync(videoContentDir).filter(f => f.endsWith('.jpg') || f.endsWith('.vtt') || f.endsWith('.srt'));
    for (const asset of assets) {
      const src = path.join(videoContentDir, asset);
      const dest = path.join(videoStaticDir, asset);

      if (asset.endsWith('.vtt')) {
        const rawVtt = fs.readFileSync(src, 'utf-8');
        fs.writeFileSync(dest, applySubtitleLinePosition(rawVtt), 'utf-8');
        continue;
      }

      fs.copyFileSync(src, dest);
    }

    // Copy HLS tree
    const hlsSrc = path.join(videoContentDir, 'hls');
    if (fs.existsSync(hlsSrc)) {
      copyDir(hlsSrc, path.join(videoStaticDir, 'hls'));
    }

    writeFile(
      path.join(videoStaticDir, 'index.html'),
      generateVideoHTML(video, categories, basePath, videoShareCard, navigation, analytics)
    );
  }
}

export async function publish(): Promise<void> {
  await generateStaticSite();
  const syncResult = await uploadToS3();
  await invalidateCloudFrontIfConfigured(syncResult);
}
