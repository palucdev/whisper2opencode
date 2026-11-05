import fs from "fs";

// Copy the 'agents' folder recursively into 'dist/agents'
fs.cpSync("src/agents", "dist/agents", { recursive: true });

console.log("Copied agents to dist/");
