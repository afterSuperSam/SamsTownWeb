// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SelectField } from "./SelectField";

afterEach(cleanup);

describe("SelectField keyboard interaction", () => {
  it("moves focus, selects with Enter and restores trigger focus", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SelectField
      value="viewer"
      label="Role"
      options={[
        { value: "viewer", label: "Viewer" },
        { value: "member", label: "Member" }
      ]}
      onChange={onChange}
    />);

    const trigger = screen.getByRole("button", { name: "Role" });
    await user.click(trigger);
    expect(screen.getByRole("option", { name: "Viewer" })).toBe(document.activeElement);
    await user.keyboard("{ArrowDown}{Enter}");

    expect(onChange).toHaveBeenCalledWith("member");
    expect(trigger).toBe(document.activeElement);
  });

  it("closes with Escape and restores trigger focus", async () => {
    const user = userEvent.setup();
    render(<SelectField value="viewer" label="Role" options={[{ value: "viewer", label: "Viewer" }]} onChange={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "Role" });
    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(trigger).toBe(document.activeElement);
  });
});
