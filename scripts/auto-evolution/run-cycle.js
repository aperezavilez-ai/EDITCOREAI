const { orchestrateCycle } = require('./orchestrator');
const result = orchestrateCycle();
console.log(JSON.stringify(result, null, 2));
