import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { OfficeLawVitePlugin } from "./src/server/vite";

const lawPlugin=new OfficeLawVitePlugin(
	dirname(fileURLToPath(import.meta.url))
);

export default defineConfig({
	plugins:[react(),lawPlugin.createPlugin()]
});
