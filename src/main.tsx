import React from "react";
import { createRoot } from "react-dom/client";
import { migrateLocalStorage } from "./ui";
import App from "./App";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";

migrateLocalStorage();
createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
