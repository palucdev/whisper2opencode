import fs from 'node:fs';

// Copy the 'skills' folder recursively into 'dist/skills'
if (fs.existsSync('src/skills')) {
  fs.cpSync('src/skills', 'dist/skills', { recursive: true });
  console.log('Copied skills to dist/');
}

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
