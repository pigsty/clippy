import fs from 'fs';
import path from 'path';
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
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { lookup as mimeLookup } from 'mime-types';

export const STATIC_DIR = path.join(CONTENT_DIR, 'static');
const execAsync = promisify(exec);

interface GenerateOptions {
  forPreview?: boolean;
}

interface ShareCardData {
  label: string;
  url: string;
  qrCodeDataUrl: string;
}

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

async function uploadToS3(): Promise<void> {
  const bucket = process.env.S3_BUCKET;
  const region = process.env.S3_REGION || 'us-east-1';

  if (!bucket) {
    console.log('S3_BUCKET not configured — skipping upload');
    return;
  }

  const client = new S3Client({ region });
  const files = getAllFiles(STATIC_DIR);

  for (const file of files) {
    const key = path.relative(STATIC_DIR, file).replace(/\\/g, '/');
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

  console.log(`Published ${files.length} files to s3://${bucket}`);
}

async function generateAvatar(srcPath: string, destPath: string): Promise<void> {
  await execAsync(
    `ffmpeg -i "${srcPath}" -vf "scale=500:500:force_original_aspect_ratio=increase,crop=500:500" -frames:v 1 -q:v 2 "${destPath}" -y`
  );
}

export async function generateStaticSite(options: GenerateOptions = {}): Promise<void> {
  const forPreview = options.forPreview === true;
  const basePath = forPreview ? '/preview' : '';
  const fallbackShareBaseUrl = forPreview ? 'http://localhost:3000/preview' : 'http://localhost:3000';

  fs.rmSync(STATIC_DIR, { recursive: true, force: true });
  fs.mkdirSync(STATIC_DIR, { recursive: true });

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
    const avatarDest = path.join(STATIC_DIR, 'avatar.jpg');
    await generateAvatar(avatarSrc, avatarDest);
  }

  // Index
  writeFile(
    path.join(STATIC_DIR, 'index.html'),
    generateIndexHTML(published, categories, bio, hasAvatar, basePath, siteShareCard, analytics)
  );

  // Category pages
  for (const category of categories) {
    const catVideos = published.filter(video => extractTags(video.meta.title).includes(category.tag));
    const catDir = path.join(STATIC_DIR, 'category', category.label);
    fs.mkdirSync(catDir, { recursive: true });
    writeFile(
      path.join(catDir, 'index.html'),
      generateCategoryHTML(catVideos, categories, bio, hasAvatar, category.tag, basePath, siteShareCard, analytics)
    );
  }

  if (forPreview) {
    // Preview points to existing content without duplicating video assets.
    const previewVideoRoot = path.join(STATIC_DIR, 'video');
    fs.mkdirSync(previewVideoRoot, { recursive: true });
    for (const video of published) {
      const videoStaticDir = path.join(STATIC_DIR, 'video', video.slug);
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
        fs.symlinkSync(subtitlesSrc, path.join(videoStaticDir, subtitleName));
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
    const videoStaticDir = path.join(STATIC_DIR, 'video', video.slug);
    const videoShareCard = await buildShareCard(
      'Share video',
      shareBaseUrl ? `${shareBaseUrl}/video/${video.slug}/` : undefined
    );
    const navigation = buildVideoNavigation(published, categories, video.slug, basePath);
    fs.mkdirSync(videoStaticDir, { recursive: true });

    // Copy thumbs
    const assets = fs.readdirSync(videoContentDir).filter(f => f.endsWith('.jpg') || f.endsWith('.vtt') || f.endsWith('.srt'));
    for (const asset of assets) {
      fs.copyFileSync(path.join(videoContentDir, asset), path.join(videoStaticDir, asset));
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
  await uploadToS3();
}
