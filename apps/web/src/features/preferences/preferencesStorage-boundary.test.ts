import preferencesStorageSource from "./preferencesStorage.ts?raw";
import { describe, expect, it } from "vitest";

describe("preferences storage bundle boundary", () => {
  it("does not import full terminal runtime modules into app startup preferences", () => {
    expect(preferencesStorageSource).not.toMatch(/from\s+["']\.\.\/terminal\/highlighting["']/);
    expect(preferencesStorageSource).not.toMatch(/from\s+["']\.\.\/terminal\/theme["']/);
  });
});
