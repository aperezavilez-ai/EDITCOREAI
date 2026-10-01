const webSearch = require('./web-search');
const filesystem = require('./filesystem');
const git = require('./git-tool');

module.exports = { ...webSearch, ...filesystem, ...git };
