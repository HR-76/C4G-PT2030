const { createJobRegistry } = require('./jobRegistry');
const productionRegistry=createJobRegistry([]);
module.exports={productionRegistry};
