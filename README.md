# Clippy

Super-lightweight self-hosted CMS and static site generator for short-form vertical video content. The generated site features a tiled homepage of posts with a bio at the top, just like the popular social video sites. You can host the CMS on your own server at home and push the generated site to AWS S3 to be served via Cloudfront. As well as being simple and fast it's highly reliable - if the CMS is down, the static site will still work.

## What it does

- Stores everything on disk (no database)
- Uploads a video and creates HLS output (360p, 480p, 720p, 1080p)
- Extracts 5 thumbnails automatically
- Lets you pick a thumbnail or upload a custom one
- Transcribes subtitles automatically and allows you to make edits
- Uses hashtags in the title as categories (example: `My clip #travel #food`)
- Generates a static site on demand
- Lets you preview static output locally before publishing to S3

## Quick start

1. Copy env file and set secrets:

   ```bash
   cp .env.example .env
   ```

2. Edit `.env`:

   - `ADMIN_PASSWORD` = admin login password
   - `SESSION_SECRET` = random string
   - `S3_BUCKET`, `S3_REGION` for publishing
   - `CF_DISTRIBUTION_ARN` to invalidate CloudFront cache after publish (optional)

3. Start with Docker:

   ```bash
   docker compose up --build
   ```

4. Open admin:

   - http://localhost:3000/admin/login

## Uploading content

1. In Admin, use **Upload video**.
2. Enter a title. Add hashtags in the same title for categories.
   - Example: `Sunset walk #travel #city`
3. Select a vertical video file.
4. After upload/transcode, open the video edit page:
   - pick a generated thumbnail, or
   - upload a custom thumbnail
   - optionally add tile overlay text, set its top position (%), and font size
5. Mark **Published** and save.

Notes:
- Max duration is 5 minutes.
- Videos are ordered by `publishDate` (if set) or upload time.

## Avatar

- Put an image at `content/avatar.jpg` on the host.
- Generate preview again (or publish) to include it in static output.

## Bio

- Go to **Admin -> Bio**.
- Save your profile text.
- Generate preview again (or publish) to include updates.

## Categories from hashtags

- Categories are extracted from hashtags in video titles.
- `#travel` creates a travel category.
- Category circles appear at the top of the static site.
- Category pages are generated automatically from published videos.

## Preview before S3 publish

1. In Admin, click **Generate preview**.
2. Open preview at:
   - http://localhost:3000/preview/
3. Review pages/videos/categories.
4. When ready, click **Publish to S3**.

Preview note:
- Preview generation does not duplicate video/HLS files.
- It reuses files from `content/videos` and only rebuilds static HTML.

## Data layout

- `content/videos/<slug>/original.mp4`
- `content/videos/<slug>/meta.json`
- `content/videos/<slug>/thumb1.jpg ... thumb5.jpg` (plus optional `custom-thumb.jpg`)
- `content/videos/<slug>/hls/...`
- `content/static/...` (generated static site)
- `content/bio.txt`
- `content/avatar.jpg`
