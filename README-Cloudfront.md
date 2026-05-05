# CloudFront Setup for Directory Index Routes

This project publishes static pages as directory indexes, for example:

- `category/mycat/index.html`
- `video/molkaw3g/index.html`

The generated links use clean URLs like `/category/mycat/` and `/video/molkaw3g/`.
When CloudFront is in front of the S3 REST origin, nested directory URLs are not resolved to `index.html` automatically.

Use a CloudFront Function on **Viewer request** to rewrite requests.

## 1. Create CloudFront Function

Function code:

```js
function handler(event) {
  var request = event.request;
  var uri = request.uri || "";

  // Leave real files alone.
  if (uri.includes(".")) {
    return request;
  }

  // Root path.
  if (uri === "" || uri === "/") {
    request.uri = "/index.html";
    return request;
  }

  // Directory path with trailing slash.
  if (uri.endsWith("/")) {
    request.uri = uri + "index.html";
    return request;
  }

  // Slashless path like /category/mycat -> /category/mycat/index.html
  request.uri = uri + "/index.html";
  return request;
}
```

## 2. Attach Function to Distribution

1. Open your CloudFront distribution.
2. Go to **Functions**.
3. Create a function, for example `rewrite-directory-index`.
4. Paste the function code.
5. Publish the function.
6. Open the behavior serving the site (usually default behavior).
7. Add function association:
   - Event type: `Viewer request`
   - Function: `rewrite-directory-index`
8. Save and deploy.

## 3. Recommended Distribution Settings

- Keep **Default root object** as `index.html`.
- Avoid SPA-style error rewrites that map all `403`/`404` to `/index.html` with `200`.
- If desired, map `404` to `/404.html` with response code `404`.

## 4. Validate After Deploy

Test each pair:

- `/category/mycat` and `/category/mycat/`
- `/video/molkaw3g` and `/video/molkaw3g/`

Expected behavior after rewrite:

- `/category/mycat` -> `/category/mycat/index.html`
- `/category/mycat/` -> `/category/mycat/index.html`
- `/video/molkaw3g` -> `/video/molkaw3g/index.html`
- `/video/molkaw3g/` -> `/video/molkaw3g/index.html`

The function intentionally does **not** rewrite asset paths such as:

- `/avatar.jpg`
- `/video/molkaw3g/hls/master.m3u8`
