import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.localStorage.setItem("online-ssh-language", "en-US");
  window.localStorage.setItem("online-ssh-theme", "dark");
  document.documentElement.lang = "en-US";
  document.documentElement.dataset.theme = "dark";
});
