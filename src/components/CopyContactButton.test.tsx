// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopyContactButton } from "./CopyContactButton";

describe("CopyContactButton", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("copies the contact value and shows a success state", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

    render(<CopyContactButton
      value="123456789"
      label="镇群 QQ：123456789"
      copiedLabel="复制成功"
      failedLabel="复制失败"
    />);

    fireEvent.click(screen.getByRole("button", { name: "镇群 QQ：123456789" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("123456789"));
    expect(screen.getByRole("button", { name: "复制成功" }).classList.contains("is-copied")).toBe(true);
  });

  it("shows a failure state when clipboard access is unavailable", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("clipboard denied"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

    render(<CopyContactButton
      value="987654321"
      label="镇长 QQ：987654321"
      copiedLabel="复制成功"
      failedLabel="复制失败"
    />);

    fireEvent.click(screen.getByRole("button", { name: "镇长 QQ：987654321" }));

    expect(await screen.findByRole("button", { name: "复制失败" })).not.toBeNull();
  });
});
