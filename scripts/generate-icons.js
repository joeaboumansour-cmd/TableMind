const fs = require('fs');
const path = require('path');

// Read the SVG file
const svgContent = fs.readFileSync(path.join(__dirname, '../public/icons/icon-512x512.svg'), 'utf8');

// Create a simple HTML file that can be used to generate PNG icons
const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <title>Icon Generator</title>
  <style>
    body { margin: 0; padding: 20px; background: #333; }
    .icon { margin: 10px; display: inline-block; }
    canvas { border: 1px solid #666; }
  </style>
</head>
<body>
  <h1>PWA Icon Generator</h1>
  <p>Right-click on each icon and save as PNG with the specified filename.</p>
  
  <div class="icon">
    <h3>72x72</h3>
    <canvas id="canvas72" width="72" height="72"></canvas>
  </div>
  
  <div class="icon">
    <h3>96x96</h3>
    <canvas id="canvas96" width="96" height="96"></canvas>
  </div>
  
  <div class="icon">
    <h3>128x128</h3>
    <canvas id="canvas128" width="128" height="128"></canvas>
  </div>
  
  <div class="icon">
    <h3>144x144</h3>
    <canvas id="canvas144" width="144" height="144"></canvas>
  </div>
  
  <div class="icon">
    <h3>152x152</h3>
    <canvas id="canvas152" width="152" height="152"></canvas>
  </div>
  
  <div class="icon">
    <h3>192x192</h3>
    <canvas id="canvas192" width="192" height="192"></canvas>
  </div>
  
  <div class="icon">
    <h3>384x384</h3>
    <canvas id="canvas384" width="384" height="384"></canvas>
  </div>
  
  <div class="icon">
    <h3>512x512</h3>
    <canvas id="canvas512" width="512" height="512"></canvas>
  </div>

  <script>
    const svgContent = \`${svgContent.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`;
    
    const sizes = [72, 96, 128, 144, 152, 192, 384, 512];
    
    sizes.forEach(size => {
      const canvas = document.getElementById('canvas' + size);
      const ctx = canvas.getContext('2d');
      
      const img = new Image();
      const svgBlob = new Blob([svgContent], {type: 'image/svg+xml;charset=utf-8'});
      const url = URL.createObjectURL(svgBlob);
      
      img.onload = function() {
        ctx.drawImage(img, 0, 0, size, size);
        URL.revokeObjectURL(url);
      };
      
      img.src = url;
    });
  </script>
</body>
</html>
`;

// Create icons directory if it doesn't exist
const iconsDir = path.join(__dirname, '../public/icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// Write the HTML file
fs.writeFileSync(path.join(iconsDir, 'generate-icons.html'), htmlContent);

console.log('Icon generator created at public/icons/generate-icons.html');
console.log('Open this file in a browser and right-click to save each icon as PNG');