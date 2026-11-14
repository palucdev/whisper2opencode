import fs from 'node:fs';

export const fileSystem = {
  existsSync: fs.existsSync,
  statSync: fs.statSync,
  readFileSync: fs.readFileSync,
  readdirSync: fs.readdirSync,
  writeFileSync: fs.writeFileSync,
  mkdirSync: fs.mkdirSync,
  renameSync: fs.renameSync,
};
