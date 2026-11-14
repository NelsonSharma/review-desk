import { cp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const staging = new URL("../.dist-build/", import.meta.url);
const output = new URL("../dist/", import.meta.url);
await rm(staging, { recursive: true, force: true });
await mkdir(staging);
await cp(new URL("../public/", import.meta.url), staging, { recursive: true });
const licenses = new URL("licenses/", staging);
await mkdir(licenses);
for (const name of ["react", "react-dom", "scheduler", "lucide-react", "katex", "zod"]) {
  await cp(new URL("../node_modules/" + name + "/LICENSE", import.meta.url), new URL(name + ".txt", licenses));
}
await build({
  entryPoints: [fileURLToPath(new URL("../src/main.tsx", import.meta.url))],
  outfile: fileURLToPath(new URL("app.js", staging)),
  external: ["/fonts/*"],
  bundle: true, minify: true, target: ["es2022"], jsx: "automatic", legalComments: "external",
  loader: { ".woff": "file", ".woff2": "file", ".ttf": "file" },
  assetNames: "assets/[name]-[hash]",
  define: { "process.env.NODE_ENV": '"production"' },
});
await writeFile(new URL("index.html", staging), `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Collect papers, compare methods, and write your literature review.">
  <title>Review Desk</title>
  <link rel="icon" href="/icon.png">
  <script src="/theme.js"></script>
  <link rel="stylesheet" href="/app.css">
  <script type="module" src="/app.js"></script>
</head>
<body><div id="root"></div><noscript>Enable JavaScript to open Review Desk.</noscript></body>
</html>
`);
await rm(output, { recursive: true, force: true });
await rename(staging, output);
console.log("Built Review Desk.");
