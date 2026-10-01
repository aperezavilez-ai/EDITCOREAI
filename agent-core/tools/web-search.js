const axios = require('axios');

async function searchWeb(query) {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const response = await axios.get(url, { timeout: 10000 });
    if (response.data.AbstractText) {
      return `Resultado: ${response.data.AbstractText}\nFuente: ${response.data.AbstractURL}`;
    }
    if (response.data.RelatedTopics && response.data.RelatedTopics.length > 0) {
      const topics = response.data.RelatedTopics.filter(t => t.Text).slice(0, 3).map(t => `- ${t.Text}`).join('\n');
      return `Resultados relacionados:\n${topics}`;
    }
    return 'No se encontraron resultados para esta búsqueda.';
  } catch (error) {
    return `Error en la búsqueda web: ${error.message}`;
  }
}
module.exports = { searchWeb };
