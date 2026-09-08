import { useState } from "react";

/** The keyboard fallback, always available for judges without a microphone. */
export function Keyboard({ busy, onSend }: { busy: boolean; onSend: (text: string) => void }) {
  const [text, setText] = useState("");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!text.trim() || busy) return;
        onSend(text);
        setText("");
      }}
    >
      <label className="keyboard-label" htmlFor="keyboard-input">
        Or type what you would say
      </label>
      <div className="keyboard">
        <input
          id="keyboard-input"
          aria-label="Ask Alexa by keyboard"
          placeholder="Alexa, play the story Grandpa sent"
          autoComplete="off"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
        <button type="submit" className="pill pill-secondary" disabled={busy || !text.trim()}>
          Send
        </button>
      </div>
    </form>
  );
}
