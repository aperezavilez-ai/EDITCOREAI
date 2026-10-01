const fs = require('fs').promises;
const path = require('path');
const config = require('../config.json');

function isPathAllowed(targetPath) {
  const resolved = path.resolve(targetPath);
  return config.allowedDirectories.some(dir => resolved.startsWith(path.resolve(dir)));
}
async function readFile(filePath) {
  if (!isPathAllowed(filePath)) throw new Error('Acceso denegado: Ruta fuera de los directorios permitidos.');
  return await fs.readFile(filePath, 'utf-8');
}
async function writeFile(filePath, content) {
  if (!isPathAllowed(filePath)) throw new Error('Acceso denegado: Ruta fuera de los directorios permitidos.');
  await fs.writeFile(filePath, content, 'utf-8');
  return `Archivo escrito exitosamente en: ${filePath}`;
}
async function listDirectory(dirPath) {
  if (!isPathAllowed(dirPath)) throw new Error('Acceso denegado: Ruta fuera de los directorios permitidos.');
  const files = await fs.readdir(dirPath, { withFileTypes: true });
  return files.map(f => ({ name: f.name, isDirectory: f.isDirectory() }));
}
module.exports = { readFile, writeFile, listDirectory };
