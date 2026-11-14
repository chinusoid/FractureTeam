import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import ClientApp from "../../src/components/ClientApp";
import "../../src/app/globals.css";

const el = document.getElementById("root");
if (el) {
  createRoot(el).render(
    <StrictMode>
      <ClientApp />
    </StrictMode>,
  );
}
