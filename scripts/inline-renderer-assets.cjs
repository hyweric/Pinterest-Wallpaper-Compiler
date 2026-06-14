const { readFileSync, readdirSync, writeFileSync } = require("node:fs");
const path = require("node:path");

const rendererDir = path.join(__dirname, "..", "dist", "renderer");
const assetsDir = path.join(rendererDir, "assets");
const htmlPath = path.join(rendererDir, "index.html");

const jsFile = readdirSync(assetsDir).find((file) => file.endsWith(".js"));
const cssFile = readdirSync(assetsDir).find((file) => file.endsWith(".css"));

if (!jsFile || !cssFile) {
  throw new Error("Could not find renderer JS and CSS assets to inline.");
}

const css = readFileSync(path.join(assetsDir, cssFile), "utf8").replaceAll("</style", "<\\/style");
const js = readFileSync(path.join(assetsDir, jsFile), "utf8")
  .replace(/new URL\(([`'"])(?!\.{0,2}\/|\/|[a-zA-Z][a-zA-Z\d+.-]*:)([^`'"]+\.(?:webp|png|jpe?g|gif|svg|avif|woff2?))\1,\s*import\.meta\.url\)/g, "new URL($1assets/$2$1,import.meta.url)")
  .replaceAll("</script", "<\\/script");
const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Pinterest Wallpaper Compiler</title>
    <style>${css}</style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module">${js}</script>
  </body>
</html>
`;

writeFileSync(htmlPath, html, "utf8");
console.log(`Inlined ${cssFile} and ${jsFile} into dist/renderer/index.html`);
