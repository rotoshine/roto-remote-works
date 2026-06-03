import { describe, it, expect } from "vitest";
import { waitFor } from "@testing-library/react";
import { mountOverlay } from "./mount";
import type { BridgeClient } from "./client";

const client = {
  listComments: async () => [],
  getStatus: async () => ({ state: "idle", currentStep: null, perComment: {}, result: null, updatedAt: "t" }),
  getQuestion: async () => null,
} as unknown as BridgeClient;

describe("mountOverlay", () => {
  it("mounts into a shadow root, renders the FAB + injects styles, and unmounts cleanly", async () => {
    const unmount = mountOverlay({ client, target: document.body });

    const host = document.body.querySelector("[data-rrw-host]") as HTMLElement | null;
    expect(host).toBeTruthy();
    expect(host!.shadowRoot).toBeTruthy();
    expect(host!.shadowRoot!.querySelector("style")).toBeTruthy();

    await waitFor(() => expect(host!.shadowRoot!.querySelector(".rrw-fab")).toBeTruthy());

    unmount();
    expect(document.body.querySelector("[data-rrw-host]")).toBeNull();
  });
});
