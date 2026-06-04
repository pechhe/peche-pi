import { register } from "node:module";

// Registers the `.js` -> `.ts` resolve hook (see hooks.mjs) so `node --test`
// can run the package's tests directly against TypeScript source.
register("./hooks.mjs", import.meta.url);
