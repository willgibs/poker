import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";

import "@poker/ui/fonts.css";
import "@poker/ui/tokens.css";
import "@poker/ui/components.css";
import "./app.css";

import { createAppRouter } from "./router";

const router = createAppRouter();

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("missing #root");

createRoot(rootEl).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
