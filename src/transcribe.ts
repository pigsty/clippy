import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  GetTranscriptionJobCommand,
  StartTranscriptionJobCommand,
  TranscribeClient,
} from '@aws-sdk/client-transcribe';
import { CONTENT_DIR, Video } from './videos';

const execAsync = promisify(exec);

export interface TranscriptionStepResult {
  status: 'in_progress' | 'completed' | 'failed';
  message: string;
  jobName?: string;
  subtitlesFile?: string;
  error?: string;
}

function getRegion(): string {
  return (process.env.S3_REGION || process.env.AWS_REGION || 'us-east-1').trim();
}

function getBucket(): string {
  const bucket = (process.env.S3_BUCKET || '').trim();
  if (!bucket) {
    throw new Error('S3_BUCKET is required for transcription');
  }

  return bucket;
}

function safeJobName(slug: string): string {
  const base = slug.toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 80) || 'video';
  return `clippy-${base}-${Date.now()}`;
}

function videoDir(slug: string): string {
  return path.join(CONTENT_DIR, 'videos', slug);
}

function subtitlesPath(slug: string): string {
  return path.join(videoDir(slug), 'subtitles.vtt');
}

async function createLowQualityTranscribeInput(slug: string): Promise<string | undefined> {
  const hls360Path = path.join(videoDir(slug), 'hls', '360', 'index.m3u8');
  if (!fs.existsSync(hls360Path)) {
    return undefined;
  }

  const outPath = path.join(videoDir(slug), `transcribe-360-${Date.now()}.mp4`);
  try {
    await execAsync(
      `ffmpeg -i "${hls360Path}" -c:v copy -c:a copy -movflags +faststart "${outPath}" -y`,
      { maxBuffer: 50 * 1024 * 1024 }
    );

    if (!fs.existsSync(outPath)) {
      return undefined;
    }

    return outPath;
  } catch (_err) {
    if (fs.existsSync(outPath)) {
      fs.rmSync(outPath, { force: true });
    }
    return undefined;
  }
}

async function uploadVideoToS3(slug: string): Promise<string> {
  const bucket = getBucket();
  const region = getRegion();
  const fallbackPath = path.join(videoDir(slug), 'original.mp4');
  if (!fs.existsSync(fallbackPath)) {
    throw new Error('original.mp4 not found for this video');
  }

  const lowQualityPath = await createLowQualityTranscribeInput(slug);
  const sourcePath = lowQualityPath || fallbackPath;

  const key = `transcribe-input/${slug}/${lowQualityPath ? 'low-360' : 'original'}-${Date.now()}.mp4`;
  const s3 = new S3Client({ region });
  try {
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: fs.readFileSync(sourcePath),
      ContentType: 'video/mp4',
    }));
  } finally {
    if (lowQualityPath && fs.existsSync(lowQualityPath)) {
      fs.rmSync(lowQualityPath, { force: true });
    }
  }

  return `s3://${bucket}/${key}`;
}

async function startJob(slug: string): Promise<string> {
  const mediaUri = await uploadVideoToS3(slug);
  const region = getRegion();
  const jobName = safeJobName(slug);
  const transcribe = new TranscribeClient({ region });

  await transcribe.send(new StartTranscriptionJobCommand({
    TranscriptionJobName: jobName,
    Media: { MediaFileUri: mediaUri },
    IdentifyLanguage: true,
    Subtitles: {
      Formats: ['vtt'],
      OutputStartIndex: 1,
    },
  }));

  return jobName;
}

async function fetchSubtitleVtt(jobName: string): Promise<string> {
  const region = getRegion();
  const transcribe = new TranscribeClient({ region });
  const response = await transcribe.send(new GetTranscriptionJobCommand({
    TranscriptionJobName: jobName,
  }));

  const status = response.TranscriptionJob?.TranscriptionJobStatus;
  if (status === 'FAILED') {
    throw new Error(response.TranscriptionJob?.FailureReason || 'Transcription failed');
  }

  if (status !== 'COMPLETED') {
    throw new Error('Transcription is not completed yet');
  }

  const subtitleUris = response.TranscriptionJob?.Subtitles?.SubtitleFileUris || [];
  const vttUri = subtitleUris.find(uri => uri.toLowerCase().includes('.vtt'));
  if (!vttUri) {
    throw new Error('No VTT subtitle file returned by AWS Transcribe');
  }

  const subtitleRes = await fetch(vttUri);
  if (!subtitleRes.ok) {
    throw new Error(`Failed to download subtitles (${subtitleRes.status})`);
  }

  return await subtitleRes.text();
}

export async function runTranscriptionStep(video: Video): Promise<TranscriptionStepResult> {
  const current = video.meta.transcriptionStatus || 'idle';
  const jobName = (video.meta.transcriptionJobName || '').trim();

  if (!jobName || current === 'idle' || current === 'failed' || current === 'completed') {
    const startedJob = await startJob(video.slug);
    return {
      status: 'in_progress',
      message: 'Transcription started. Click the button again in a bit to refresh status.',
      jobName: startedJob,
    };
  }

  const region = getRegion();
  const transcribe = new TranscribeClient({ region });
  const response = await transcribe.send(new GetTranscriptionJobCommand({
    TranscriptionJobName: jobName,
  }));
  const status = response.TranscriptionJob?.TranscriptionJobStatus;

  if (status === 'QUEUED' || status === 'IN_PROGRESS') {
    return {
      status: 'in_progress',
      message: 'Transcription is still processing. Try again shortly.',
      jobName,
    };
  }

  if (status === 'FAILED') {
    const reason = response.TranscriptionJob?.FailureReason || 'Transcription failed';
    return {
      status: 'failed',
      message: reason,
      jobName,
      error: reason,
    };
  }

  const vtt = await fetchSubtitleVtt(jobName);
  const outPath = subtitlesPath(video.slug);
  fs.writeFileSync(outPath, vtt, 'utf-8');

  return {
    status: 'completed',
    message: 'Transcription complete. Subtitles saved and ready to edit.',
    jobName,
    subtitlesFile: 'subtitles.vtt',
  };
}
