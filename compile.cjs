const fs = require("fs");
const path = require("path");
const { transform } = require("sucrase");

const files = [
  "src/agents/skills/workspace.ts",
  "src/config/types.skills.ts",
  "src/config/zod-schema.ts",
];

files.forEach((file) => {
  const srcPath = path.resolve(file);
  const outPath = path.resolve(
    file.replace("src/", "dist/").replace(".ts", ".js"),
  );

  if (!fs.existsSync(srcPath)) {
    console.error(`Source not found: ${srcPath}`);
    return;
  }

  const code = fs.readFileSync(srcPath, "utf8");
  const result = transform(code, {
    transforms: ["typescript", "imports"],
  });

  const outDir = path.dirname(outPath);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  fs.writeFileSync(outPath, result.code);
  console.log(`Compiled: ${file} -> ${outPath} (${result.code.length} bytes)`);
});
