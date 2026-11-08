import React from "react";
import { createRoot } from "react-dom/client";
import { migrateLocalStorage } from "./ui";
import App from "./App";
import "@xterm/xterm/css/xterm.css";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./styles.css";
import "./wiki.css";
import "./design-system.css";

migrateLocalStorage();
createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
