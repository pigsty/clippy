import fs from 'fs';
import path from 'path';

export const CONTENT_DIR = process.env.CONTENT_DIR || '/data/content';

export interface VideoMeta {
  slug: string;
  title: string;
  publishDate?: string;
  thumb?: string;
  published?: boolean;
  uploadedAt: string;
}

export interface Video {
  slug: string;
  meta: VideoMeta;
  thumbs: string[];
  hasHLS: boolean;
}

export interface CategorySummary {
  tag: string;
  label: string;
  coverVideoSlug?: string;
  coverThumb?: string;
}

export function extractTags(title: string): string[] {
  return (title.match(/#[\w]+/g) || []).map(tag => tag.toLowerCase());
}

export function getCategorySummaries(videos: Video[]): CategorySummary[] {
  const categories = new Map<string, CategorySummary>();

  for (const video of videos) {
    const coverThumb = video.meta.thumb || video.thumbs[0];
    for (const tag of extractTags(video.meta.title)) {
      if (categories.has(tag)) {
        continue;
      }

      categories.set(tag, {
        tag,
        label: tag.slice(1),
        coverVideoSlug: coverThumb ? video.slug : undefined,
        coverThumb,
      });
    }
  }

  return Array.from(categories.values());
}

function getVideoSync(slug: string): Video | null {
  const dir = path.join(CONTENT_DIR, 'videos', slug);
  const metaPath = path.join(dir, 'meta.json');
  if (!fs.existsSync(metaPath)) return null;

  const meta: VideoMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

  const possibleThumbs = ['thumb1.jpg', 'thumb2.jpg', 'thumb3.jpg', 'thumb4.jpg', 'thumb5.jpg', 'custom-thumb.jpg'];
  const thumbs = possibleThumbs.filter(t => fs.existsSync(path.join(dir, t)));
  const hasHLS = fs.existsSync(path.join(dir, 'hls', 'master.m3u8'));

  return { slug, meta, thumbs, hasHLS };
}

export function listVideos(): Video[] {
  const videosDir = path.join(CONTENT_DIR, 'videos');
  if (!fs.existsSync(videosDir)) return [];

  const slugs = fs.readdirSync(videosDir).filter(d =>
    fs.statSync(path.join(videosDir, d)).isDirectory()
  );

  const videos = slugs.map(s => getVideoSync(s)).filter(Boolean) as Video[];

  return videos.sort((a, b) => {
    const da = a.meta.publishDate || a.meta.uploadedAt;
    const db = b.meta.publishDate || b.meta.uploadedAt;
    return db.localeCompare(da);
  });
}

export function getVideo(slug: string): Video | null {
  return getVideoSync(slug);
}

export function saveVideoMeta(slug: string, meta: VideoMeta): void {
  const dir = path.join(CONTENT_DIR, 'videos', slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
}

export function deleteVideo(slug: string): void {
  const dir = path.join(CONTENT_DIR, 'videos', slug);
  fs.rmSync(dir, { recursive: true, force: true });
}
