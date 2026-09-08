import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PENDING_KEY } from "../oauth/connect.ts";
import { routedFetch } from "../test/agent-fixtures.ts";
import { Callback } from "./Callback.tsx";

const ORIGIN = "http://localhost:5173";

describe("Callback page", () => {
  it("exchanges the code with the stored verifier and hands the access token up", async () => {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ verifier: "ver1fier", state: "st" }));
    const fetchImpl = routedFetch({
      "POST /oauth/token": ({ body }) => {
        const form = Object.fromEntries(new URLSearchParams(String(body)));
        expect(form).toEqual({
          grant_type: "authorization_code",
          code: "c0de",
          code_verifier: "ver1fier",
          redirect_uri: `${ORIGIN}/demo/callback`,
          client_id: "simulator",
        });
        return Response.json({ access_token: "jwt-1", token_type: "Bearer", expires_in: 900, scope: "mcp:tools" });
      },
    });
    const onLinked = vi.fn();
    render(<Callback origin={ORIGIN} search="?code=c0de&state=st" fetchImpl={fetchImpl} onLinked={onLinked} onCancel={vi.fn()} />);
    await vi.waitFor(() => {
      expect(onLinked).toHaveBeenCalledWith("jwt-1");
    });
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it("refuses a state that does not match the pending flow", async () => {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ verifier: "v", state: "expected" }));
    const fetchImpl = routedFetch({});
    const onLinked = vi.fn();
    render(<Callback origin={ORIGIN} search="?code=c0de&state=other" fetchImpl={fetchImpl} onLinked={onLinked} onCancel={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/state/i);
    expect(onLinked).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("shows the authorization server's error and offers the way back", async () => {
    const onCancel = vi.fn();
    render(
      <Callback
        origin={ORIGIN}
        search="?error=access_denied&error_description=The+parent+declined"
        fetchImpl={routedFetch({})}
        onLinked={vi.fn()}
        onCancel={onCancel}
      />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("The parent declined");
    await userEvent.setup().click(screen.getByRole("button", { name: /back to the demo/i }));
    expect(onCancel).toHaveBeenCalled();
  });
});
