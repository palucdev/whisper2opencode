import fs from 'fs';

// Copy the 'agents' folder recursively into 'dist/agents'
if (fs.existsSync('src/agents')) {
  fs.cpSync('src/agents', 'dist/agents', { recursive: true });
  console.log('Copied agents to dist/');
}

// Copy the 'commands' folder recursively into 'dist/commands'
if (fs.existsSync('src/commands')) {
  fs.cpSync('src/commands', 'dist/commands', { recursive: true });
  console.log('Copied commands to dist/');
}
