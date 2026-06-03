/**
 * pi-gui questionnaire extension.
 *
 * Provides a `questionnaire` tool that lets the agent ask a small batch of
 * multiple-choice questions through pi-gui's native questionnaire dialog
 * instead of pi's terminal-only `ui.custom` renderer.
 *
 * Drop this file into your extensions directory and enable it in Settings →
 * Extensions. The Plan composer mode in pi-gui will then route grilling
 * questions through this UI.
 *
 * The host-side bridge lives in:
 *   packages/pi-sdk-driver/src/session-supervisor.ts (ctx.ui.questionnaire)
 *   apps/desktop/src/extension-session-ui.tsx (renderer)
 */

import type { Extension, ExtensionContext, ExtensionTool } from "@earendil-works/pi-coding-agent";

interface QuestionnaireOption {
  value: string;
  label: string;
  description?: string;
  recommended?: boolean;
}

interface QuestionnaireQuestion {
  id: string;
  label?: string;
  prompt: string;
  options: QuestionnaireOption[];
  allowOther?: boolean;
  otherPlaceholder?: string;
}

interface QuestionnaireInput {
  title?: string;
  intro?: string;
  questions: QuestionnaireQuestion[];
}

const tool: ExtensionTool = {
  label: "questionnaire",
  description:
    "Ask the user a structured multiple-choice questionnaire in pi-gui. " +
    "Use this during grill-with-docs / planning to gather decisions one question at a time. " +
    "Each option must have a stable `value`. Mark a `recommended: true` option when you have a strong default. " +
    "Set `allowOther: true` if the user should be able to type a free-text answer.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["questions"],
    properties: {
      title: { type: "string" },
      intro: { type: "string" },
      questions: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "prompt", "options"],
          properties: {
            id: { type: "string" },
            label: { type: "string" },
            prompt: { type: "string" },
            allowOther: { type: "boolean" },
            otherPlaceholder: { type: "string" },
            options: {
              type: "array",
              minItems: 2,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["value", "label"],
                properties: {
                  value: { type: "string" },
                  label: { type: "string" },
                  description: { type: "string" },
                  recommended: { type: "boolean" },
                },
              },
            },
          },
        },
      },
    },
  } as const,
  async execute(this: void, args: QuestionnaireInput, ctx: ExtensionContext) {
    const ui = ctx.ui as unknown as {
      questionnaire?: (input: QuestionnaireInput) => Promise<
        readonly { id: string; value: string; label: string; wasCustom: boolean }[] | undefined
      >;
    };
    if (typeof ui.questionnaire !== "function") {
      throw new Error(
        "Host UI does not support `questionnaire`. Run this extension inside pi-gui.",
      );
    }
    const answers = await ui.questionnaire({
      title: args.title,
      intro: args.intro,
      questions: args.questions,
    });
    if (!answers) {
      return { cancelled: true as const };
    }
    return { cancelled: false as const, answers };
  },
};

const extension: Extension = {
  name: "questionnaire-pi-gui",
  tools: [tool],
};

export default extension;
