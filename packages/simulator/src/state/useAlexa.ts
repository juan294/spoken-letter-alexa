import { useCallback, useEffect, useReducer, useRef } from "react";
import { AgentError, type AgentTransport, type SessionRequest } from "../agent/types.ts";
import { initialState, reduce } from "./alexa.ts";

function describe(error: unknown): string {
  if (error instanceof AgentError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong talking to the agent.";
}

/**
 * Owns the session and the turn loop. `accessToken` null means demo mode; a token
 * (memory only) opens a linked session. Changing it starts a new conversation.
 */
export function useAlexa(transport: AgentTransport, accessToken: string | null) {
  const [state, dispatch] = useReducer(reduce, initialState);
  const sessionRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    sessionRef.current = null;
    dispatch({ type: "session", session: null });
    const request: SessionRequest = accessToken ? { mode: "linked", accessToken } : { mode: "demo" };
    transport
      .createSession(request)
      .then((session) => {
        if (cancelled) return;
        sessionRef.current = session.sessionId;
        dispatch({ type: "session", session });
      })
      .catch((error: unknown) => {
        if (!cancelled) dispatch({ type: "turn-fail", message: describe(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [transport, accessToken]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      dispatch({ type: "turn-start" });
      try {
        let sessionId = sessionRef.current;
        if (!sessionId) {
          const session = await transport.createSession(accessToken ? { mode: "linked", accessToken } : { mode: "demo" });
          sessionRef.current = session.sessionId;
          sessionId = session.sessionId;
        }
        const response = await transport.turn(sessionId, trimmed);
        dispatch({ type: "turn-ok", you: trimmed, response });
      } catch (error) {
        dispatch({ type: "turn-fail", message: describe(error) });
      }
    },
    [transport, accessToken],
  );

  const sendAudio = useCallback(
    async (audio: Blob) => {
      dispatch({ type: "turn-start" });
      try {
        const { text } = await transport.transcribe(audio);
        if (!text.trim()) {
          dispatch({ type: "turn-fail", message: "I did not catch that. Try again, or type below." });
          return;
        }
        await send(text);
      } catch (error) {
        dispatch({ type: "turn-fail", message: describe(error) });
      }
    },
    [transport, send],
  );

  return { state, dispatch, send, sendAudio };
}
