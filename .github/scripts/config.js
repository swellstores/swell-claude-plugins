export const SCHEMAS = [
  {
    input: "schema/model.json",
    output: "types/model.d.ts",
    promptFile: ".github/scripts/prompts/model.prompt.txt",
    r2Keys: {
      bundled: "schema-bundle/model.bundled.json",
      types: "types/model.d.ts",
    },
  },
  {
    input: "schema/content.json",
    output: "types/content.d.ts",
    promptFile: ".github/scripts/prompts/content.prompt.txt",
    r2Keys: {
      bundled: "schema-bundle/content.bundled.json",
      types: "types/content.d.ts",
    },
  },
  {
    input: "schema/notification.json",
    output: "types/notification.d.ts",
    promptFile: ".github/scripts/prompts/notification.prompt.txt",
    r2Keys: {
      bundled: "schema-bundle/notification.bundled.json",
      types: "types/notification.d.ts",
    },
  },
  {
    input: "schema/setting.json",
    output: "types/setting.d.ts",
    promptFile: ".github/scripts/prompts/setting.prompt.txt",
    r2Keys: {
      bundled: "schema-bundle/setting.bundled.json",
      types: "types/setting.d.ts",
    },
  },
  {
    input: "schema/webhook.json",
    output: "types/webhook.d.ts",
    promptFile: ".github/scripts/prompts/webhook.prompt.txt",
    r2Keys: {
      bundled: "schema-bundle/webhook.bundled.json",
      types: "types/webhook.d.ts",
    },
  },
];
