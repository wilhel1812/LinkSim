console.error(
  [
    "[deploy:staging] This script is deprecated and intentionally disabled.",
    "Use guarded deploy commands instead:",
    "- npm run deploy:staging:preview",
    "- npm run deploy:staging:main",
    "- npm run deploy:prod:main",
  ].join("\n"),
);
process.exit(1);
