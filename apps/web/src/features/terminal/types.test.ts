import { describe, expect, it } from "vitest";

import type {
  TerminalCommandAssistantResponse,
  TerminalCommandAssistantResult
} from "./types";

const commandResult: TerminalCommandAssistantResult = {
  command_text: "ls -la",
  name: "List files",
  risk_level: "low"
};

describe("terminal command assistant response types", () => {
  it("allows exactly one command assistant response variant", () => {
    const resultResponse: TerminalCommandAssistantResponse = { result: commandResult };
    const rawResponse: TerminalCommandAssistantResponse = {
      invalid_response: true,
      raw_response: "plain text"
    };
    const unsupportedResponse: TerminalCommandAssistantResponse = {
      unsupported_request: true,
      refusal_message: "Ask for a shell command.",
      suggested_prompt: "List files in the current directory"
    };

    expect(resultResponse).toHaveProperty("result");
    expect(rawResponse).toHaveProperty("raw_response", "plain text");
    expect(unsupportedResponse).toHaveProperty("unsupported_request", true);
  });
});

// @ts-expect-error command results and unsupported responses are mutually exclusive.
const mixedUnsupportedResponse: TerminalCommandAssistantResponse = {
  result: commandResult,
  unsupported_request: true,
  refusal_message: "Ask for a shell command."
} as const;
void mixedUnsupportedResponse;

// @ts-expect-error raw model output must be explicitly marked invalid.
const rawWithoutInvalidFlag: TerminalCommandAssistantResponse = {
  raw_response: "plain text"
} as const;
void rawWithoutInvalidFlag;
