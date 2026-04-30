import { CategorySummary, extractTags, Video } from './videos';

interface ShareCardData {
  label: string;
  url: string;
  qrCodeDataUrl: string;
}

export interface AnalyticsConfig {
  measurementId: string;
}

export interface VideoNavigationData {
  overall: {
    previous?: string;
    next?: string;
    back: string;
  };
  byCategory: Record<string, {
    previous?: string;
    next?: string;
    back: string;
  }>;
}

const PUBLIC_CSS = `
:root {
  --bg: #ffffff;
  --surface: #ffffff;
  --surface-muted: #f7f7f7;
  --text: #111111;
  --text-muted: #666666;
  --border: #e8e8e8;
  --accent: #0095f6;
  --ring: #111111;
  --shadow: rgba(17, 17, 17, 0.08);
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0d0f12;
    --surface: #14171c;
    --surface-muted: #1d2128;
    --text: #f5f7fa;
    --text-muted: #a3adb8;
    --border: #2a313b;
    --accent: #61b9ff;
    --ring: #f5f7fa;
    --shadow: rgba(0, 0, 0, 0.3);
  }
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: var(--bg);
  color: var(--text);
  max-width: 480px;
  margin: 0 auto;
}
a { color: inherit; text-decoration: none; }

.profile { display: flex; align-items: flex-start; gap: 14px; padding: 20px 16px 14px; }
.profile-avatar { width: 72px; height: 72px; border-radius: 50%; object-fit: cover;
  border: 2px solid var(--border); flex-shrink: 0; background: var(--surface-muted); }
.profile-avatar-placeholder { width: 72px; height: 72px; border-radius: 50%;
  background: linear-gradient(135deg, #f59e0b, #ef4444); flex-shrink: 0; }
.profile-copy { flex: 1; min-width: 0; }
.profile-bio { font-size: 14px; line-height: 1.45; color: var(--text); white-space: pre-line; }

.share-open {
  margin-top: 10px;
  border: none;
  border-radius: 999px;
  padding: 10px 14px;
  background: var(--text);
  color: var(--bg);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.share-modal {
  position: fixed;
  inset: 0;
  display: none;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.62);
  z-index: 999;
}
.share-modal.open { display: flex; }
.share-modal-panel {
  width: min(360px, 100%);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 16px;
  box-shadow: 0 20px 40px var(--shadow);
  padding: 18px 16px;
  text-align: center;
}
.share-modal-title {
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.share-modal-link {
  display: block;
  margin-top: 10px;
  font-size: 13px;
  line-height: 1.4;
  color: var(--accent);
  word-break: break-all;
}
.share-modal-qr {
  display: block;
  width: 172px;
  height: 172px;
  margin: 14px auto 0;
  border-radius: 12px;
  background: #ffffff;
  padding: 8px;
}
.share-modal-actions {
  margin-top: 14px;
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
}
.share-modal-btn {
  border: none;
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.share-modal-btn.copy { background: var(--text); color: var(--bg); }
.share-modal-btn.close { background: var(--surface-muted); color: var(--text); }

.categories {
  display: flex;
  gap: 14px;
  padding: 6px 16px 14px;
  overflow-x: auto;
  scrollbar-width: none;
}
.categories::-webkit-scrollbar { display: none; }
.cat-item { display: flex; flex-direction: column; align-items: center; gap: 6px; flex-shrink: 0; cursor: pointer; }
.cat-circle {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  border: 2px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: var(--surface-muted);
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
  transition: border-color .2s, transform .2s;
}
.cat-circle.active { border-color: var(--ring); transform: translateY(-1px); }
.cat-circle img { width: 100%; height: 100%; object-fit: cover; }
.cat-label {
  font-size: 11px;
  color: var(--text-muted);
  max-width: 68px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2px; padding: 0; }
.grid-item { position: relative; aspect-ratio: 9/16; overflow: hidden; background: #000; }
.grid-item img { width: 100%; height: 100%; object-fit: cover; transition: opacity .2s; }
.grid-item:hover img { opacity: .85; }

hr.divider { border: none; border-top: 1px solid var(--border); margin: 0 16px; }

.video-wrap { position: relative; width: 100%; aspect-ratio: 9/16; background: #000; }
.video-wrap video { width: 100%; height: 100%; object-fit: contain; }
.video-info { padding: 14px 16px 24px; }
.video-title { font-size: 18px; font-weight: 700; line-height: 1.3; margin-bottom: 6px; white-space: pre-line; }
.video-date { font-size: 12px; color: var(--text-muted); margin-bottom: 10px; }
.video-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.tag { font-size: 12px; color: var(--accent); }
.back-btn { display: inline-flex; align-items: center; gap: 6px; padding: 12px 16px; font-size: 14px; color: var(--text); }
.back-btn svg { width: 18px; height: 18px; }

@media (max-width: 480px) {
  .share-modal-qr { width: 148px; height: 148px; }
}
`;

const ADMIN_CSS = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
       background: #f5f5f5; color: #111; }
a { color: #0070f3; text-decoration: none; }
.nav { background: #111; color: #fff; padding: 12px 20px;
       display: flex; align-items: center; justify-content: space-between; }
.nav strong { font-size: 16px; letter-spacing: 1px; }
.nav-links { display: flex; gap: 16px; font-size: 13px; }
.nav-links a { color: #ccc; }
.nav-links a:hover { color: #fff; }
.container { max-width: 960px; margin: 0 auto; padding: 24px 20px; }
.card { background: #fff; border-radius: 8px; padding: 20px;
        box-shadow: 0 1px 4px rgba(0,0,0,.08); margin-bottom: 20px; }
h1 { font-size: 20px; margin-bottom: 16px; }
h2 { font-size: 16px; margin-bottom: 12px; }
label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 4px; color: #444; }
input[type=text], input[type=password], input[type=date], textarea, select {
  width: 100%; padding: 8px 10px; border: 1px solid #ddd; border-radius: 6px;
  font-size: 14px; font-family: inherit; margin-bottom: 12px; background: #fff; }
textarea { resize: vertical; min-height: 80px; }
.btn { display: inline-block; padding: 8px 16px; border-radius: 6px; font-size: 14px;
       font-weight: 600; cursor: pointer; border: none; transition: opacity .15s; }
.btn:hover { opacity: .85; }
.btn-primary { background: #111; color: #fff; }
.btn-success { background: #0070f3; color: #fff; }
.btn-danger { background: #e00; color: #fff; }
.btn-sm { padding: 5px 10px; font-size: 12px; }
.flash { padding: 10px 14px; border-radius: 6px; margin-bottom: 16px; font-size: 14px; }
.flash-ok { background: #d4edda; color: #155724; }
.flash-err { background: #f8d7da; color: #721c24; }
.video-list { display: grid; gap: 12px; }
.video-row { display: flex; align-items: center; gap: 14px; }
.video-row img { width: 54px; height: 96px; object-fit: cover; border-radius: 4px;
                 background: #000; flex-shrink: 0; }
.video-row-info { flex: 1; min-width: 0; }
.video-row-title { font-size: 14px; font-weight: 600; white-space: pre-line;
                   overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.video-row-meta { font-size: 12px; color: #777; margin-top: 2px; }
.video-row-actions { display: flex; gap: 8px; flex-shrink: 0; }
.badge { display: inline-block; padding: 2px 8px; border-radius: 20px; font-size: 11px;
         font-weight: 700; }
.badge-pub { background: #d4edda; color: #155724; }
.badge-draft { background: #fff3cd; color: #856404; }
.thumb-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; margin-bottom: 12px; }
.thumb-option { position: relative; aspect-ratio: 9/16; cursor: pointer; }
.thumb-option img { width: 100%; height: 100%; object-fit: cover; border-radius: 4px;
                    border: 3px solid transparent; }
.thumb-option input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.thumb-option input:checked + img { border-color: #0070f3; }
`;

function formatDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function escHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderText(value: string): string {
  return escHtml(value).replace(/\n/g, '<br>');
}

function stripTags(title: string): string {
  return title.replace(/#[\w]+/g, '').replace(/[ \t]+$/gm, '').trim();
}

function thumbUrl(video: Video, basePath = ''): string {
  const thumb = video.meta.thumb || video.thumbs[0] || '';
  if (!thumb) {
    return '';
  }

  return `${basePath}/video/${video.slug}/${thumb}`;
}

function renderShareButton(shareCard?: ShareCardData): string {
  if (!shareCard) {
    return '';
  }

  return `<button
    class="share-open"
    type="button"
    data-share-label="${escHtml(shareCard.label)}"
    data-share-url="${escHtml(shareCard.url)}"
    data-share-qr="${shareCard.qrCodeDataUrl}">
    Share
  </button>`;
}

function renderAnalyticsBootstrap(analytics?: AnalyticsConfig): string {
  if (!analytics) {
    return '';
  }

  const measurementId = JSON.stringify(analytics.measurementId);
  return `<script async src="https://www.googletagmanager.com/gtag/js?id=${analytics.measurementId}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){window.dataLayer.push(arguments);}
  window.gtag = window.gtag || gtag;
  gtag('js', new Date());
  gtag('config', ${measurementId}, { send_page_view: false });
</script>`;
}

function renderHomepageAnalytics(analytics?: AnalyticsConfig): string {
  if (!analytics) {
    return '';
  }

  return `<script>
  if (window.gtag) {
    window.gtag('event', 'homepage_view');
  }
</script>`;
}

function renderVideoAnalytics(video: Video, analytics?: AnalyticsConfig): string {
  if (!analytics) {
    return '';
  }

  const slug = JSON.stringify(video.slug);
  const title = JSON.stringify(stripTags(video.meta.title));

  return `<script>
  (function() {
    var slug = ${slug};
    var title = ${title};
    if (window.gtag) {
      window.gtag('event', 'video_page_view', {
        video_slug: slug,
        video_title: title,
      });
    }

    var player = document.getElementById('player');
    if (!(player instanceof HTMLVideoElement)) {
      return;
    }

    var sent = false;
    function trackPlayMilestone() {
      if (sent || player.currentTime < 2) {
        return;
      }
      sent = true;
      if (window.gtag) {
        window.gtag('event', 'video_play_2s', {
          video_slug: slug,
          video_title: title,
        });
      }
    }

    player.addEventListener('timeupdate', trackPlayMilestone);
    player.addEventListener('seeked', trackPlayMilestone);
  })();
</script>`;
}

function renderCategoryCircle(category: CategorySummary, basePath: string, activeTag?: string): string {
  const active = category.tag === activeTag ? ' active' : '';
  const href = `${basePath}/category/${category.label}/`;
  const cover = category.coverThumb && category.coverVideoSlug
    ? `<img src="${basePath}/video/${category.coverVideoSlug}/${category.coverThumb}" alt="#${escHtml(category.label)}">`
    : `#${escHtml(category.label)}`;

  return `<a class="cat-item" href="${href}">
    <div class="cat-circle${active}">${cover}</div>
    <span class="cat-label">#${escHtml(category.label)}</span>
  </a>`;
}

function publicLayout(opts: {
  title: string;
  head?: string;
  bio?: string;
  hasAvatar?: boolean;
  categories: CategorySummary[];
  activeCategory?: string;
  basePath?: string;
  content: string;
  profileShareCard?: ShareCardData;
  showProfile?: boolean;
  allCoverVideo?: Video;
}): string {
  const {
    title,
    bio = '',
    hasAvatar = false,
    categories,
    activeCategory,
    basePath = '',
    content,
    head = '',
    profileShareCard,
    showProfile = true,
    allCoverVideo,
  } = opts;

  const allCover = allCoverVideo ? thumbUrl(allCoverVideo, basePath) : '';
  const catItems = [
    `<a class="cat-item" href="${basePath}/">
      <div class="cat-circle${!activeCategory ? ' active' : ''}">${allCover ? `<img src="${allCover}" alt="All">` : 'All'}</div>
      <span class="cat-label">All</span>
    </a>`,
    ...categories.map(category => renderCategoryCircle(category, basePath, activeCategory)),
  ].join('\n');

  const avatarEl = hasAvatar
    ? `<img class="profile-avatar" src="${basePath}/avatar.jpg" alt="avatar">`
    : `<div class="profile-avatar-placeholder"></div>`;

  const profileBlock = showProfile
    ? `<div class="profile">
        ${avatarEl}
        <div class="profile-copy">
          <p class="profile-bio">${renderText(bio)}</p>
          ${renderShareButton(profileShareCard)}
        </div>
      </div>
      <hr class="divider">
      <div class="categories">${catItems}</div>
      <hr class="divider">`
    : `<div class="categories">${catItems}</div>
      <hr class="divider">`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(title)}</title>
<style>${PUBLIC_CSS}</style>
${head}
</head>
<body>
${profileBlock}
${content}
<div id="share-modal" class="share-modal" aria-hidden="true">
  <div class="share-modal-panel" role="dialog" aria-modal="true" aria-labelledby="share-modal-title">
    <p id="share-modal-title" class="share-modal-title">Share</p>
    <a id="share-modal-link" class="share-modal-link" href="#"></a>
    <img id="share-modal-qr" class="share-modal-qr" src="" alt="Share QR code">
    <div class="share-modal-actions">
      <button id="share-modal-copy" class="share-modal-btn copy" type="button">Copy link</button>
      <button id="share-modal-close" class="share-modal-btn close" type="button">Close</button>
    </div>
  </div>
</div>
<script>
  (function() {
    var modal = document.getElementById('share-modal');
    var modalTitle = document.getElementById('share-modal-title');
    var modalLink = document.getElementById('share-modal-link');
    var modalQr = document.getElementById('share-modal-qr');
    var copyButton = document.getElementById('share-modal-copy');
    var closeButton = document.getElementById('share-modal-close');
    var currentUrl = '';

    function closeModal() {
      if (!(modal instanceof HTMLElement)) {
        return;
      }
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
    }

    async function copyCurrentUrl() {
      if (!currentUrl) {
        return;
      }
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(currentUrl);
        } else {
          window.prompt('Copy this link', currentUrl);
        }
        if (copyButton instanceof HTMLElement) {
          var original = copyButton.textContent;
          copyButton.textContent = 'Copied';
          window.setTimeout(function() {
            copyButton.textContent = original || 'Copy link';
          }, 1200);
        }
      } catch (_error) {
        window.prompt('Copy this link', currentUrl);
      }
    }

    document.addEventListener('click', function(event) {
      var target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      var trigger = target.closest('[data-share-url]');
      if (trigger instanceof HTMLElement) {
        if (!(modal instanceof HTMLElement) || !(modalLink instanceof HTMLAnchorElement) || !(modalQr instanceof HTMLImageElement) || !(modalTitle instanceof HTMLElement)) {
          return;
        }
        var label = trigger.getAttribute('data-share-label') || 'Share';
        var url = trigger.getAttribute('data-share-url') || '';
        var qr = trigger.getAttribute('data-share-qr') || '';
        currentUrl = url;
        modalTitle.textContent = label;
        modalLink.textContent = url;
        modalLink.href = url;
        modalQr.src = qr;
        modal.classList.add('open');
        modal.setAttribute('aria-hidden', 'false');
        return;
      }

      if (target === modal || target === closeButton) {
        closeModal();
        return;
      }

      if (target === copyButton) {
        copyCurrentUrl();
      }
    });

    document.addEventListener('keydown', function(event) {
      if (event.key === 'Escape') {
        closeModal();
      }
    });
  })();
</script>
</body>
</html>`;
}

function videoHref(video: Video, basePath = '', categoryLabel?: string): string {
  if (!categoryLabel) {
    return `${basePath}/video/${video.slug}/`;
  }

  return `${basePath}/video/${video.slug}/?category=${encodeURIComponent(categoryLabel)}`;
}

function videoGrid(videos: Video[], basePath = '', categoryLabel?: string): string {
  if (!videos.length) {
    return `<p style="padding:32px 16px;color:var(--text-muted);text-align:center">No videos yet.</p>`;
  }

  const items = videos.map(video => {
    const thumb = thumbUrl(video, basePath);
    const image = thumb
      ? `<img src="${thumb}" alt="${escHtml(video.meta.title)}" loading="lazy">`
      : `<div style="width:100%;height:100%;background:#222"></div>`;
    return `<a class="grid-item" href="${videoHref(video, basePath, categoryLabel)}">${image}</a>`;
  }).join('\n');

  return `<div class="grid">${items}</div>`;
}

export function generateIndexHTML(
  videos: Video[],
  categories: CategorySummary[],
  bio: string,
  hasAvatar: boolean,
  basePath = '',
  shareCard?: ShareCardData,
  analytics?: AnalyticsConfig
): string {
  return publicLayout({
    title: 'Videos',
    head: renderAnalyticsBootstrap(analytics),
    bio,
    hasAvatar,
    categories,
    basePath,
    profileShareCard: shareCard,
    allCoverVideo: videos[0],
    content: videoGrid(videos, basePath) + renderHomepageAnalytics(analytics),
  });
}

export function generateCategoryHTML(
  videos: Video[],
  categories: CategorySummary[],
  bio: string,
  hasAvatar: boolean,
  activeCategory: string,
  basePath = '',
  shareCard?: ShareCardData,
  analytics?: AnalyticsConfig
): string {
  return publicLayout({
    title: `${activeCategory} videos`,
    head: renderAnalyticsBootstrap(analytics),
    bio,
    hasAvatar,
    categories,
    activeCategory,
    basePath,
    profileShareCard: shareCard,
    allCoverVideo: videos[0],
    content: videoGrid(videos, basePath, activeCategory.slice(1)),
  });
}

export function generateVideoHTML(
  video: Video,
  categories: CategorySummary[],
  basePath = '',
  shareCard?: ShareCardData,
  navigation?: VideoNavigationData,
  analytics?: AnalyticsConfig
): string {
  const tagLinks = extractTags(video.meta.title).map(tag =>
    `<a class="tag" href="${basePath}/category/${tag.slice(1)}/">${tag}</a>`
  ).join('');

  const hlsScript = `
<script src="https://cdn.jsdelivr.net/npm/hls.js@1"></script>
<script>
  (function() {
    var player = document.getElementById('player');
    var src = 'hls/master.m3u8';
    if (typeof Hls !== 'undefined' && Hls.isSupported()) {
      var hls = new Hls();
      hls.loadSource(src);
      hls.attachMedia(player);
    } else if (player.canPlayType('application/vnd.apple.mpegurl')) {
      player.src = src;
    }
  })();
</script>`;

  const navigationScript = navigation
    ? `
<script>
  (function() {
    var nav = ${JSON.stringify(navigation)};
    var params = new URLSearchParams(window.location.search);
    var category = params.get('category') || '';
    var current = nav.overall;
    if (category && nav.byCategory[category]) {
      current = nav.byCategory[category];
    }

    var backLink = document.getElementById('back-link');
    if (backLink && current.back) {
      backLink.setAttribute('href', current.back);
    }

    var startX = 0;
    var startY = 0;
    var threshold = 70;
    document.addEventListener('touchstart', function(event) {
      if (!event.touches || event.touches.length !== 1) {
        return;
      }
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
    }, { passive: true });

    document.addEventListener('touchend', function(event) {
      if (!event.changedTouches || event.changedTouches.length !== 1) {
        return;
      }
      var endX = event.changedTouches[0].clientX;
      var endY = event.changedTouches[0].clientY;
      var dx = endX - startX;
      var dy = endY - startY;

      if (Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy)) {
        return;
      }

      if (dx < 0 && current.next) {
        window.location.href = current.next;
      } else if (dx > 0 && current.previous) {
        window.location.href = current.previous;
      }
    }, { passive: true });
  })();
</script>`
    : '';

  const poster = video.meta.thumb ? `${basePath}/video/${video.slug}/${video.meta.thumb}` : '';
  const content = `
<a id="back-link" class="back-btn" href="${basePath}/">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M19 12H5M12 5l-7 7 7 7"/>
  </svg>
  Back
</a>
<div class="video-wrap">
  <video id="player" controls playsinline poster="${poster}"></video>
</div>
<div class="video-info">
  <p class="video-title">${renderText(stripTags(video.meta.title))}</p>
  <p class="video-date">${formatDate(video.meta.publishDate || video.meta.uploadedAt)}</p>
  ${renderShareButton(shareCard)}
  <div class="video-tags">${tagLinks}</div>
</div>`;

  return publicLayout({
    title: stripTags(video.meta.title),
    head: renderAnalyticsBootstrap(analytics),
    categories,
    basePath,
    showProfile: false,
    allCoverVideo: video,
    content: content + hlsScript + navigationScript + renderVideoAnalytics(video, analytics),
  });
}

function adminLayout(title: string, content: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — Clippy</title>
<style>${ADMIN_CSS}</style>
</head>
<body>
<nav class="nav">
  <strong>CLIPPY</strong>
  <div class="nav-links">
    <a href="/admin">Videos</a>
    <a href="/admin/bio">Bio</a>
    <form method="POST" action="/admin/logout" style="margin:0">
      <button style="background:none;border:none;color:#ccc;cursor:pointer;font-size:13px">Logout</button>
    </form>
  </div>
</nav>
<div class="container">${content}</div>
</body>
</html>`;
}

export function loginPage(error = false): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Login — Clippy</title>
<style>
${ADMIN_CSS}
.login-wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center;
              background: #f5f5f5; }
.login-card { background: #fff; border-radius: 10px; padding: 36px 32px; width: 340px;
              box-shadow: 0 2px 12px rgba(0,0,0,.1); }
.login-title { font-size: 22px; font-weight: 700; margin-bottom: 24px; text-align: center; }
</style>
</head>
<body>
<div class="login-wrap">
  <div class="login-card">
    <div class="login-title">Clippy</div>
    ${error ? `<div class="flash flash-err">Incorrect password.</div>` : ''}
    <form method="POST" action="/admin/login">
      <label for="pw">Password</label>
      <input id="pw" type="password" name="password" autofocus required>
      <button class="btn btn-primary" style="width:100%;padding:10px" type="submit">Login</button>
    </form>
  </div>
</div>
</body>
</html>`;
}

export function adminPage(videos: Video[], flash?: string, isError = false, previewReady = false): string {
  const flashHtml = flash
    ? `<div class="flash ${isError ? 'flash-err' : 'flash-ok'}">${escHtml(flash)}</div>`
    : '';

  const rows = videos.map(video => {
    const thumb = video.thumbs.length ? `/content/videos/${video.slug}/${video.meta.thumb || video.thumbs[0]}` : '';
    const badge = video.meta.published
      ? `<span class="badge badge-pub">Published</span>`
      : `<span class="badge badge-draft">Draft</span>`;
    const date = formatDate(video.meta.publishDate || video.meta.uploadedAt);
    return `<div class="card video-row">
      ${thumb ? `<img src="${thumb}" alt="">` : `<div style="width:54px;height:96px;background:#222;border-radius:4px"></div>`}
      <div class="video-row-info">
        <div class="video-row-title">${renderText(video.meta.title)}</div>
        <div class="video-row-meta">${date} &nbsp; ${badge}</div>
      </div>
      <div class="video-row-actions">
        <a class="btn btn-sm btn-primary" href="/admin/video/${video.slug}">Edit</a>
        <form method="POST" action="/admin/video/${video.slug}/delete" onsubmit="return confirm('Delete this video?')">
          <button class="btn btn-sm btn-danger" type="submit">Del</button>
        </form>
      </div>
    </div>`;
  }).join('\n');

  const uploadCard = `
<div class="card">
  <h2>Upload video</h2>
  <form method="POST" action="/admin/upload" enctype="multipart/form-data">
    <label>Title (use #hashtags for categories)</label>
    <textarea name="title" rows="3" placeholder="My awesome clip\n#travel #food" required></textarea>
    <label>Video file (MP4, max 5 min)</label>
    <input type="file" name="video" accept="video/*" required style="margin-bottom:12px">
    <button class="btn btn-success" type="submit">Upload &amp; Transcode</button>
  </form>
</div>`;

  const publishCard = `
<div class="card" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
  <div>
    <strong>Static output</strong>
    <p style="font-size:13px;color:#666;margin-top:2px">Generate static HTML for preview, then publish to S3 when ready.</p>
    ${previewReady ? '<p style="font-size:13px;color:#0070f3;margin-top:6px"><a href="/preview/" target="_blank" rel="noopener">Open latest preview</a></p>' : ''}
  </div>
  <div style="display:flex;gap:10px;flex-wrap:wrap">
    <form method="POST" action="/admin/preview">
      <button class="btn btn-success" type="submit">Generate preview</button>
    </form>
    <form method="POST" action="/admin/publish">
      <button class="btn btn-primary" type="submit">Publish to S3</button>
    </form>
  </div>
</div>`;

  const content = `
${flashHtml}
${uploadCard}
${publishCard}
<h1>Videos (${videos.length})</h1>
<div class="video-list">${rows || '<p style="color:#999">No videos yet.</p>'}</div>
`;

  return adminLayout('Videos', content);
}

export function editVideoPage(video: Video, saved = false): string {
  const thumbOptions = video.thumbs.map(thumb => {
    const url = `/content/videos/${video.slug}/${thumb}`;
    const checked = (video.meta.thumb || video.thumbs[0]) === thumb ? 'checked' : '';
    return `<label class="thumb-option">
      <input type="radio" name="thumb" value="${thumb}" ${checked}>
      <img src="${url}" alt="${thumb}">
    </label>`;
  }).join('');

  const content = `
${saved ? `<div class="flash flash-ok">Saved!</div>` : ''}
<a href="/admin" style="font-size:13px;color:#666">← Back to videos</a>
<div class="card" style="margin-top:12px">
  <h1>Edit video</h1>
  <form method="POST" action="/admin/video/${video.slug}">
    <label>Title (use #hashtags for categories)</label>
    <textarea name="title" rows="4" required>${escHtml(video.meta.title)}</textarea>
    <label>Publish date override (optional)</label>
    <input type="date" name="publishDate" value="${video.meta.publishDate || ''}">
    <label>Thumbnail</label>
    <div class="thumb-grid">${thumbOptions}</div>
    <label style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
      <input type="checkbox" name="published" ${video.meta.published ? 'checked' : ''}>
      <span>Published</span>
    </label>
    <button class="btn btn-primary" type="submit">Save</button>
  </form>
</div>
<div class="card">
  <h2>Upload custom thumbnail</h2>
  <form method="POST" action="/admin/video/${video.slug}/thumb" enctype="multipart/form-data">
    <input type="file" name="thumb" accept="image/*" style="margin-bottom:12px">
    <button class="btn btn-success" type="submit">Upload thumbnail</button>
  </form>
</div>
`;
  return adminLayout('Edit video', content);
}

export function bioPage(bio: string, saved = false): string {
  const content = `
${saved ? `<div class="flash flash-ok">Saved!</div>` : ''}
<div class="card">
  <h1>Bio &amp; profile</h1>
  <form method="POST" action="/admin/bio">
    <label>Bio text</label>
    <textarea name="bio" rows="4">${escHtml(bio)}</textarea>
    <button class="btn btn-primary" type="submit">Save</button>
  </form>
  <hr style="margin:20px 0;border:none;border-top:1px solid #eee">
  <h2>Avatar</h2>
  <form method="POST" action="/admin/bio/avatar" enctype="multipart/form-data">
    <input type="file" name="avatar" accept="image/*" style="margin-bottom:12px">
    <button class="btn btn-success" type="submit">Upload avatar</button>
  </form>
  <p style="font-size:13px;color:#666;margin-top:10px">
    Avatar is resized to 500x500 during preview/publish generation.
  </p>
</div>
`;
  return adminLayout('Bio', content);
}
