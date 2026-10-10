const { renderMarkdownSecure } = require('../renderer-markdown.js');
const text = `Arranco con la estructura base completa. Te genero tres archivos limpios: HTML semántico, CSS modular y JS en módulos ES6.

Creando los archivos ahora...
// filepath: index.html
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Tienda</title>
</head>
<body>
<h1>Hola</h1>
</body>
</html>`;

console.log('OUTPUT DE RENDERMARKDOWN:');
console.log(renderMarkdownSecure(text));
