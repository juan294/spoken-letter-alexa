import { useState } from "react";
import type { ToolCall } from "../agent/types.ts";
import { Eyebrow } from "../brand/Eyebrow.tsx";
import { displayToolName } from "../lib/format.ts";

/** Every MCP tool call the agent made in this session: name, latency, protocol era, outcome. */
export function UnderTheHood({ toolCalls }: { toolCalls: ToolCall[] }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="card hood" aria-label="Under the hood">
      <div className="hood-head">
        <div>
          <Eyebrow>Under the hood</Eyebrow>
          <h2 className="headline headline-card">
            Every MCP <span className="accent">tool call</span>
          </h2>
        </div>
        <button type="button" className="pill pill-ghost" aria-expanded={open} aria-controls="under-the-hood" onClick={() => { setOpen((value) => !value); }}>
          Under the hood {toolCalls.length > 0 ? `(${toolCalls.length})` : ""}
        </button>
      </div>
      {open ? (
        <div id="under-the-hood" data-testid="under-the-hood">
          {toolCalls.length === 0 ? (
            <p className="hood-empty">No tool calls yet. Ask for a story and the agent's MCP traffic appears here.</p>
          ) : (
            <ul className="hood-list">
              {toolCalls.map((call, index) => (
                <li key={`${index}-${call.name}`} className="hood-row">
                  <span className="tool" title={call.name}>
                    {displayToolName(call.name)}
                  </span>
                  <span className="era">{call.era}</span>
                  <span className="ms">{Math.round(call.ms)} ms</span>
                  <span className={call.ok ? "ok" : "fail"}>{call.ok ? "ok" : "failed"}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
