import type { ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";

interface QuestionnaireOption {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
  readonly recommended?: boolean;
}

interface QuestionnaireQuestion {
  readonly id: string;
  readonly label?: string;
  readonly prompt: string;
  readonly options: readonly QuestionnaireOption[];
  readonly allowOther?: boolean;
  readonly otherPlaceholder?: string;
}

interface QuestionnaireInput {
  readonly title?: string;
  readonly intro?: string;
  readonly questions: readonly QuestionnaireQuestion[];
}

interface QuestionnaireAnswer {
  readonly id: string;
  readonly value: string;
  readonly label: string;
  readonly wasCustom: boolean;
  readonly index?: number;
}

const questionnaireParameters = {
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
} as const;

export function createQuestionnaireTool(): ToolDefinition {
  const tool: ToolDefinition<typeof questionnaireParameters, { readonly cancelled: boolean; readonly answers?: readonly QuestionnaireAnswer[] }> = {
    name: "questionnaire",
    label: "Questionnaire",
    description:
      "Ask the user one or more structured multiple-choice questions through pi-gui's inline composer questionnaire. Use for clarifying requirements, planning decisions, and preference gathering. Each question needs stable ids and 2-6 options. Mark a recommended option when there is a strong default. Set allowOther when free text matters.",
    promptSnippet: "questionnaire - Ask structured multiple-choice questions through the inline pi-gui composer UI.",
    promptGuidelines: [
      "Use questionnaire when requirements are ambiguous and user input is needed before proceeding.",
      "Ask one focused question, or a small batch of closely-related questions, with stable ids and concise options.",
      "Include allowOther when none of the options may fit.",
    ],
    parameters: questionnaireParameters,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
      const ui = ctx.ui as unknown as {
        questionnaire?: (input: QuestionnaireInput) => Promise<readonly QuestionnaireAnswer[] | undefined>;
      };
      if (typeof ui.questionnaire !== "function") {
        return {
          content: [{ type: "text", text: "Questionnaire UI is unavailable in this host." }],
          details: { cancelled: true },
        };
      }

      const answers = await ui.questionnaire(params as QuestionnaireInput);
      if (!answers) {
        return {
          content: [{ type: "text", text: "User cancelled the questionnaire." }],
          details: { cancelled: true },
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify({ answers }, null, 2) }],
        details: { cancelled: false, answers },
      };
    },
  };
  return tool as unknown as ToolDefinition;
}
