// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultContent } from "../domain/defaults";

vi.mock("../services/siteRepository", () => ({
  getSiteContent: vi.fn().mockResolvedValue(defaultContent)
}));

const { I18nProvider, useI18n } = await import("./I18nContext");

function Probe() {
  const { language, switching, switchLanguage } = useI18n();
  return <button type="button" onClick={switchLanguage}>{language}:{String(switching)}</button>;
}

describe("I18nProvider storage fallback", () => {
  afterEach(() => vi.restoreAllMocks());

  it("starts and completes a language switch when LocalStorage is blocked", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("blocked"); });

    render(<I18nProvider><Probe /></I18nProvider>);
    const button = await screen.findByRole("button");
    fireEvent.click(button);
    await act(() => new Promise(resolve => window.setTimeout(resolve, 150)));

    expect(button).toHaveTextContent("en:false");
  });
});
