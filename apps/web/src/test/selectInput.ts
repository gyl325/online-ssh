import { screen } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";

export async function selectInputOption(user: UserEvent, combobox: HTMLElement, value: string | number) {
  await user.click(combobox);
  const options = await screen.findAllByRole("option", {}, { timeout: 1000 });
  const valueText = String(value);
  const matchingOption = options.find((item) => item.getAttribute("data-value") === valueText);
  if (!matchingOption) {
    throw new Error(`Unable to find select option with value "${valueText}".`);
  }
  await user.click(matchingOption);
}
