import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { createTransport } from "./agent/index.ts";
import "./styles/theme.css";
import "./styles/app.css";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

createRoot(root).render(
  <StrictMode>
    <App transport={createTransport()} />
  </StrictMode>,
);
