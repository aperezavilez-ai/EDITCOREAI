const simpleGit = require('simple-git');

async function cloneRepo(url, targetDir) {
  try {
    const git = simpleGit();
    await git.clone(url, targetDir);
    return `Repositorio clonado exitosamente en: ${targetDir}`;
  } catch (error) {
    return `Error al clonar: ${error.message}`;
  }
}
async function getRepoLog(repoPath, maxCount = 10) {
  try {
    const git = simpleGit(repoPath);
    const log = await git.log({ maxCount });
    return log.all.map(commit => `[${commit.hash.substring(0, 7)}] ${commit.message} - ${commit.author_name}`);
  } catch (error) {
    return `Error al leer el repositorio: ${error.message}`;
  }
}
module.exports = { cloneRepo, getRepoLog };
