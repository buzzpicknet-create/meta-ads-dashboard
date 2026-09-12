import { createRoot } from "react-dom/client";
import App from "./App";
import CreativeRoutinePreview from "./pages/CreativeRoutinePreview";
import "./index.css";
import "./header-fix.css";

// Configure API base URL
const w = window as unknown as { __API_URL__: string };
w.__API_URL__ = "";

import { setBaseUrl } from "@workspace/api-client-react";
setBaseUrl(w.__API_URL__);

const isCreativeRoutinePreview = window.location.pathname === "/creative-routine-preview";

createRoot(document.getElementById("root")!).render(
  isCreativeRoutinePreview ? <CreativeRoutinePreview /> : <App />,
);
