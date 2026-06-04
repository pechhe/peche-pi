import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The package targets NodeNext, so source modules import siblings with a
// `.js` extension (the emitted output). When running the tests against raw
// `.ts` source via `node --test`, those `.js` specifiers don't exist yet.
// This resolve hook rewrites a relative `.js` specifier to its `.ts` sibling
// when the `.js` file is absent, so tests can exercise source without a build.
export async function resolve(specifier, context, next) {
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && specifier.endsWith(".js")) {
    const jsURL = new URL(specifier, context.parentURL);
    if (!existsSync(fileURLToPath(jsURL))) {
      const tsSpecifier = specifier.replace(/\.js$/, ".ts");
      const tsURL = new URL(tsSpecifier, context.parentURL);
      if (existsSync(fileURLToPath(tsURL))) {
        return next(tsSpecifier, context);
      }
    }
  }
  return next(specifier, context);
}
