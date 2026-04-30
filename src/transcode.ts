import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { CONTENT_DIR } from './videos';

const execAsync = promisify(exec);

const MAX_DURATION = 300; // 5 minutes

// Scale to fit within portrait box, pad with black if needed
const vfPortrait = (w: number, h: number) =>
  `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black`;

export async function transcodeVideo(inputPath: string, slug: string): Promise<void> {
  const outDir = path.join(CONTENT_DIR, 'videos', slug, 'hls');
  fs.mkdirSync(path.join(outDir, '360'), { recursive: true });
  fs.mkdirSync(path.join(outDir, '480'), { recursive: true });
  fs.mkdirSync(path.join(outDir, '720'), { recursive: true });
  fs.mkdirSync(path.join(outDir, '1080'), { recursive: true });

  // Check duration
  const { stdout: probeOut } = await execAsync(
    `ffprobe -v quiet -print_format json -show_format "${inputPath}"`
  );
  const probe = JSON.parse(probeOut) as { format: { duration: string } };
  const duration = parseFloat(probe.format.duration);

  if (duration > MAX_DURATION) {
    throw new Error(`Video is ${Math.round(duration)}s — max is ${MAX_DURATION}s (5 min)`);
  }

  const optAudio = '-map 0:v:0 -map 0:a:0?';

  // 360p variant
  await execAsync(
    `ffmpeg -i "${inputPath}" \
      -vf "${vfPortrait(360, 640)}" \
      ${optAudio} \
      -c:v libx264 -preset fast -crf 28 -b:v 800k -maxrate 900k -bufsize 1600k \
      -c:a aac -b:a 96k -ar 44100 \
      -hls_time 6 -hls_list_size 0 \
      -hls_segment_filename "${outDir}/360/seg%03d.ts" \
      -f hls "${outDir}/360/index.m3u8" -y`,
    { maxBuffer: 50 * 1024 * 1024 }
  );

  // 720p variant
  await execAsync(
    `ffmpeg -i "${inputPath}" \
      -vf "${vfPortrait(720, 1280)}" \
      ${optAudio} \
      -c:v libx264 -preset fast -crf 24 -b:v 2500k -maxrate 3000k -bufsize 5000k \
      -c:a aac -b:a 128k -ar 44100 \
      -hls_time 6 -hls_list_size 0 \
      -hls_segment_filename "${outDir}/720/seg%03d.ts" \
      -f hls "${outDir}/720/index.m3u8" -y`,
    { maxBuffer: 50 * 1024 * 1024 }
  );

  // 480p variant
  await execAsync(
    `ffmpeg -i "${inputPath}" \
      -vf "${vfPortrait(480, 854)}" \
      ${optAudio} \
      -c:v libx264 -preset fast -crf 26 -b:v 1200k -maxrate 1400k -bufsize 2400k \
      -c:a aac -b:a 96k -ar 44100 \
      -hls_time 6 -hls_list_size 0 \
      -hls_segment_filename "${outDir}/480/seg%03d.ts" \
      -f hls "${outDir}/480/index.m3u8" -y`,
    { maxBuffer: 50 * 1024 * 1024 }
  );

  // 1080p variant
  await execAsync(
    `ffmpeg -i "${inputPath}" \
      -vf "${vfPortrait(1080, 1920)}" \
      ${optAudio} \
      -c:v libx264 -preset fast -crf 22 -b:v 4500k -maxrate 5500k -bufsize 9000k \
      -c:a aac -b:a 128k -ar 44100 \
      -hls_time 6 -hls_list_size 0 \
      -hls_segment_filename "${outDir}/1080/seg%03d.ts" \
      -f hls "${outDir}/1080/index.m3u8" -y`,
    { maxBuffer: 50 * 1024 * 1024 }
  );

  // Write master playlist
  const master = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-STREAM-INF:BANDWIDTH=896000,RESOLUTION=360x640',
    '360/index.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=1296000,RESOLUTION=480x854',
    '480/index.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=2628000,RESOLUTION=720x1280',
    '720/index.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=4628000,RESOLUTION=1080x1920',
    '1080/index.m3u8',
  ].join('\n');

  fs.writeFileSync(path.join(outDir, 'master.m3u8'), master);
}

export async function extractThumbs(slug: string): Promise<void> {
  const videoDir = path.join(CONTENT_DIR, 'videos', slug);
  const originalPath = path.join(videoDir, 'original.mp4');

  const { stdout } = await execAsync(
    `ffprobe -v quiet -print_format json -show_format "${originalPath}"`
  );
  const probe = JSON.parse(stdout) as { format: { duration: string } };
  const duration = parseFloat(probe.format.duration);

  // 5 evenly distributed random timestamps, avoiding first/last 5%
  const margin = duration * 0.05;
  const timestamps: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t = margin + Math.random() * (duration - 2 * margin);
    timestamps.push(t);
  }
  timestamps.sort((a, b) => a - b);

  const vf = vfPortrait(360, 640);
  for (let i = 0; i < 5; i++) {
    const t = timestamps[i].toFixed(2);
    const out = path.join(videoDir, `thumb${i + 1}.jpg`);
    await execAsync(
      `ffmpeg -ss ${t} -i "${originalPath}" -vf "${vf}" -vframes 1 -q:v 3 "${out}" -y`
    );
  }
}
