import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Configure API base URL
const w = window as unknown as { __API_URL__: string };
w.__API_URL__ = "https://dashboards-jt0h.onrender.com";

import { setBaseUrl } from "@workspace/api-client-react";
setBaseUrl(w.__API_URL__);

createRoot(document.getElementById("root")!).render(<App />);
