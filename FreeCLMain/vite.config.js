import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const fromRoot = (path) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        home: fromRoot("./index.html"),
        classic: fromRoot("./classic/index.html"),
        challenge: fromRoot("./classic/challenge/index.html"),
        extra: fromRoot("./extra/index.html"),
        extraChallenge: fromRoot("./extra/challenge/index.html"),
        platformer: fromRoot("./platformer/index.html"),
        platformerChallenge: fromRoot("./platformer/challenge/index.html"),
        submit: fromRoot("./submit/index.html"),
        ranking: fromRoot("./ranking/index.html"),
        user: fromRoot("./user/index.html"),
        search: fromRoot("./search/index.html"),
        roulette: fromRoot("./roulette/index.html"),
        account: fromRoot("./account/index.html")
      }
    }
  }
});
