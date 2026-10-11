import { defineWranglerConfig } from "wrangler/experimental-config";

export default defineWranglerConfig({
  assetsDirectory: process.env.KEYLOOP_VALIDATE_ASSETS === "true" ? "./build/validation-assets" : "./build/assets",
});
