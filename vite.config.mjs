import { resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

import { defineConfig } from "vite";
import commonjs from "vite-plugin-commonjs";
import { copy } from "vite-plugin-copy";
import tailwindcss from "@tailwindcss/vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const publicDir = resolve(__dirname, "public");
const distDir = resolve(__dirname, "dist");
const copyPlugin = copy({
  targets: [
    {
      src: `${publicDir}/**/*`,
      dest: distDir,
    },
  ],
  hook: "writeBundle",
});

export default defineConfig({
  plugins: [commonjs(), tailwindcss(), copyPlugin],
});
