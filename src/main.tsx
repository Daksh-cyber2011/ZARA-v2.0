/**
 * MYRAA — React entrypoint.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

const container = document.getElementById("root");
if (!container) throw new Error("MYRAA root element missing.");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
