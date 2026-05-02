import express from 'express';
import session from 'express-session';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

import { requireAuth, loginHandler, logoutHandler } from './auth';
import { listVideos, getVideo, saveVideoMeta, deleteVideo, CONTENT_DIR, VideoMeta } from './videos';
import { transcodeVideo, extractThumbs } from './transcode';
import { runTranscriptionStep } from './transcribe';
import { publish, generateStaticSite, STATIC_DIR } from './publish';
import { adminPage, loginPage, editVideoPage, bioPage } from './templates';

const app = express();
const PORT = process.env.PORT || 3000;
const activeTranscodes = new Set<string>();

function startBackgroundTranscode(slug: string): void {
  if (activeTranscodes.has(slug)) {
    return;
  }

  const video = getVideo(slug);
  if (!video) {
    return;
  }

  activeTranscodes.add(slug);

  setImmediate(async () => {
    const current = getVideo(slug);
    if (!current) {
      activeTranscodes.delete(slug);
      return;
    }

    saveVideoMeta(slug, {
      ...current.meta,
      transcodeStatus: 'processing',
      transcodeError: undefined,
      transcodeAttempts: (current.meta.transcodeAttempts || 0) + 1,
    });

    const originalPath = path.join(CONTENT_DIR, 'videos', slug, 'original.mp4');
    try {
      await transcodeVideo(originalPath, slug);
      await extractThumbs(slug);

      const done = getVideo(slug);
      if (!done) {
        activeTranscodes.delete(slug);
        return;
      }

      saveVideoMeta(slug, {
        ...done.meta,
        thumb: done.meta.thumb || done.thumbs[0] || 'thumb1.jpg',
        transcodeStatus: 'completed',
        transcodeError: undefined,
      });
    } catch (err) {
      console.error(`Transcode failed for ${slug}`, err);
      const failed = getVideo(slug);
      if (failed) {
        const message = err instanceof Error ? err.message : 'Transcode failed';
        saveVideoMeta(slug, {
          ...failed.meta,
          transcodeStatus: 'failed',
          transcodeError: message,
        });
      }
    } finally {
      activeTranscodes.delete(slug);
    }
  });
}

// Ensure content dir exists
fs.mkdirSync(path.join(CONTENT_DIR, 'videos'), { recursive: true });

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'changeme-set-SESSION_SECRET',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000, sameSite: 'strict' },
  })
);

// Serve uploaded content (HLS, thumbs) for the admin UI
app.use('/content', express.static(CONTENT_DIR));
app.use('/preview', requireAuth, express.static(STATIC_DIR));

// Multer for video uploads — write directly to content dir to avoid cross-device moves
const videoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, '/tmp'),
  filename: (_req, _file, cb) => cb(null, `upload-${Date.now()}.mp4`),
});
const uploadVideo = multer({
  storage: videoStorage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('video/')) {
      cb(new Error('Only video files are accepted'));
      return;
    }
    cb(null, true);
  },
});

const uploadThumb = multer({
  dest: '/tmp',
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      cb(new Error('Only image files are accepted'));
      return;
    }
    cb(null, true);
  },
});

// ---------------------------------------------------------------------------
// Auth routes
// ---------------------------------------------------------------------------

app.get('/admin/login', (req, res) => {
  res.send(loginPage(req.query.error === '1'));
});
app.post('/admin/login', loginHandler);
app.post('/admin/logout', logoutHandler);
app.get('/', (_req, res) => res.redirect('/admin'));

// ---------------------------------------------------------------------------
// Admin routes
// ---------------------------------------------------------------------------

app.get('/admin', requireAuth, (_req, res) => {
  const videos = listVideos();
  const q = _req.query as Record<string, string>;
  const flash = q.published
    ? 'Site published to S3!'
    : q.previewed
    ? 'Static site generated. Open preview to inspect before publishing.'
    : q.processing
    ? 'Upload complete. Transcoding started in the background.'
    : q.error
    ? `Error: ${q.error}`
    : undefined;
  res.send(adminPage(videos, flash, !!q.error, q.previewed === '1'));
});

app.post(
  '/admin/upload',
  requireAuth,
  uploadVideo.single('video'),
  (req, res) => {
    if (!req.file) {
      res.redirect('/admin?error=no-file');
      return;
    }

    const title = ((req.body as Record<string, string>).title || 'Untitled').trim();
    const slug = Date.now().toString(36);
    const videoDir = path.join(CONTENT_DIR, 'videos', slug);
    fs.mkdirSync(videoDir, { recursive: true });
    const originalPath = path.join(videoDir, 'original.mp4');

    try {
      // Move temp upload to content dir
      try {
        fs.renameSync(req.file.path, originalPath);
      } catch {
        fs.copyFileSync(req.file.path, originalPath);
        fs.unlinkSync(req.file.path);
      }

      saveVideoMeta(slug, {
        slug,
        title,
        uploadedAt: new Date().toISOString(),
        published: false,
        transcodeStatus: 'queued',
        transcodeAttempts: 0,
      });

      startBackgroundTranscode(slug);

      res.redirect('/admin?processing=1');
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : 'transcode failed';
      // Clean up on failure
      fs.rmSync(videoDir, { recursive: true, force: true });
      res.redirect(`/admin?error=${encodeURIComponent(msg)}`);
    }
  }
);

app.post('/admin/video/:slug/retry-processing', requireAuth, (req, res) => {
  const video = getVideo(req.params.slug);
  if (!video) {
    res.redirect('/admin');
    return;
  }

  if (video.meta.transcodeStatus === 'processing' || video.meta.transcodeStatus === 'queued') {
    res.redirect('/admin?error=Video%20is%20already%20processing');
    return;
  }

  saveVideoMeta(req.params.slug, {
    ...video.meta,
    transcodeStatus: 'queued',
    transcodeError: undefined,
  });
  startBackgroundTranscode(req.params.slug);
  res.redirect('/admin?processing=1');
});

app.get('/admin/video/:slug', requireAuth, (req, res) => {
  const video = getVideo(req.params.slug);
  if (!video) {
    res.redirect('/admin');
    return;
  }
  const subtitlesPath = path.join(CONTENT_DIR, 'videos', video.slug, video.meta.subtitlesFile || 'subtitles.vtt');
  const subtitles = fs.existsSync(subtitlesPath) ? fs.readFileSync(subtitlesPath, 'utf-8') : '';
  const flash = typeof req.query.flash === 'string' ? req.query.flash : undefined;
  const flashError = req.query.error === '1';
  res.send(editVideoPage(video, {
    saved: req.query.saved === '1',
    subtitles,
    flash,
    flashError,
  }));
});

app.post('/admin/video/:slug', requireAuth, (req, res) => {
  const video = getVideo(req.params.slug);
  if (!video) {
    res.redirect('/admin');
    return;
  }
  const body = req.body as Record<string, string>;
  const updated: VideoMeta = {
    ...video.meta,
    title: (body.title || 'Untitled').trim(),
    publishDate: body.publishDate || undefined,
    thumb: body.thumb || video.meta.thumb,
    published: body.published === 'on',
  };
  saveVideoMeta(req.params.slug, updated);
  res.redirect(`/admin/video/${req.params.slug}?saved=1`);
});

app.post('/admin/video/:slug/transcribe', requireAuth, async (req, res) => {
  const video = getVideo(req.params.slug);
  if (!video) {
    res.redirect('/admin');
    return;
  }

  try {
    const step = await runTranscriptionStep(video);
    saveVideoMeta(req.params.slug, {
      ...video.meta,
      transcriptionJobName: step.jobName || video.meta.transcriptionJobName,
      transcriptionStatus: step.status,
      transcriptionError: step.error,
      subtitlesFile: step.subtitlesFile || video.meta.subtitlesFile,
    });
    res.redirect(`/admin/video/${req.params.slug}?flash=${encodeURIComponent(step.message)}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to start transcription';
    saveVideoMeta(req.params.slug, {
      ...video.meta,
      transcriptionStatus: 'failed',
      transcriptionError: msg,
    });
    res.redirect(`/admin/video/${req.params.slug}?error=1&flash=${encodeURIComponent(msg)}`);
  }
});

app.post('/admin/video/:slug/subtitles', requireAuth, (req, res) => {
  const video = getVideo(req.params.slug);
  if (!video) {
    res.redirect('/admin');
    return;
  }

  const body = req.body as Record<string, string>;
  const subtitles = body.subtitles || '';
  const fileName = video.meta.subtitlesFile || 'subtitles.vtt';
  const subtitlesPath = path.join(CONTENT_DIR, 'videos', req.params.slug, fileName);
  fs.writeFileSync(subtitlesPath, subtitles, 'utf-8');

  saveVideoMeta(req.params.slug, {
    ...video.meta,
    subtitlesFile: fileName,
    transcriptionStatus: video.meta.transcriptionStatus || 'completed',
    transcriptionError: undefined,
  });

  res.redirect(`/admin/video/${req.params.slug}?saved=1&flash=${encodeURIComponent('Subtitles saved.')}`);
});

app.post('/admin/video/:slug/thumb', requireAuth, uploadThumb.single('thumb'), (req, res) => {
  if (!req.file) {
    res.redirect(`/admin/video/${req.params.slug}`);
    return;
  }
  const video = getVideo(req.params.slug);
  if (!video) {
    res.redirect('/admin');
    return;
  }
  const destPath = path.join(CONTENT_DIR, 'videos', req.params.slug, 'custom-thumb.jpg');
  try {
    fs.renameSync(req.file.path, destPath);
  } catch {
    fs.copyFileSync(req.file.path, destPath);
    fs.unlinkSync(req.file.path);
  }
  saveVideoMeta(req.params.slug, { ...video.meta, thumb: 'custom-thumb.jpg' });
  res.redirect(`/admin/video/${req.params.slug}?saved=1`);
});

app.post('/admin/video/:slug/delete', requireAuth, (req, res) => {
  deleteVideo(req.params.slug);
  res.redirect('/admin');
});

app.get('/admin/bio', requireAuth, (_req, res) => {
  const bioPath = path.join(CONTENT_DIR, 'bio.txt');
  const bio = fs.existsSync(bioPath) ? fs.readFileSync(bioPath, 'utf-8') : '';
  res.send(bioPage(bio, _req.query.saved === '1'));
});

app.post('/admin/bio', requireAuth, (req, res) => {
  const bioPath = path.join(CONTENT_DIR, 'bio.txt');
  const bio = ((req.body as Record<string, string>).bio || '').trim();
  fs.writeFileSync(bioPath, bio);
  res.redirect('/admin/bio?saved=1');
});

app.post('/admin/bio/avatar', requireAuth, uploadThumb.single('avatar'), (req, res) => {
  if (!req.file) {
    res.redirect('/admin/bio');
    return;
  }

  const destPath = path.join(CONTENT_DIR, 'avatar.jpg');
  try {
    fs.renameSync(req.file.path, destPath);
  } catch {
    fs.copyFileSync(req.file.path, destPath);
    fs.unlinkSync(req.file.path);
  }

  res.redirect('/admin/bio?saved=1');
});

app.post('/admin/publish', requireAuth, async (_req, res) => {
  try {
    await publish();
    res.redirect('/admin?published=1');
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'publish failed';
    console.error(err);
    res.redirect(`/admin?error=${encodeURIComponent(msg)}`);
  }
});

app.post('/admin/preview', requireAuth, async (_req, res) => {
  try {
    await generateStaticSite({ forPreview: true });
    res.redirect('/admin?previewed=1');
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'preview generation failed';
    console.error(err);
    res.redirect(`/admin?error=${encodeURIComponent(msg)}`);
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`Clippy running at http://localhost:${PORT}`);
});
