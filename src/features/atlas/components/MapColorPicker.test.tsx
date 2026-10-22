// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MapColorPicker } from "./MapColorPicker";

describe("MapColorPicker", () => {
  it("uses the themed palette instead of a native color input", () => {
    const onChange = vi.fn();
    const { container } = render(<MapColorPicker value="#e9a43a" label="认领颜色" onChange={onChange} />);

    expect(container.querySelector('input[type="color"]')).not.toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(8);
    fireEvent.click(screen.getByRole("radio", { name: "#4f9c88" }));
    expect(onChange).toHaveBeenCalledWith("#4f9c88");
  });

  it("commits only a complete hexadecimal color", () => {
    const onChange = vi.fn();
    render(<MapColorPicker value="#e9a43a" label="标记颜色" onChange={onChange} />);
    const input = screen.getByRole("textbox", { name: "标记颜色" });

    fireEvent.change(input, { target: { value: "#123" } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "#123456" } });
    expect(onChange).toHaveBeenCalledWith("#123456");
  });
});
