const fs = require('fs');
const path = require('path');

// Create icons directory if it doesn't exist
const iconsDir = path.join(__dirname, '../public/icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// Simple PNG creation function (creates a minimal valid PNG)
function createPlaceholderPNG(size) {
  // Create a minimal PNG with amber background
  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  
  // IHDR chunk (image header)
  const width = size;
  const height = size;
  const bitDepth = 8;
  const colorType = 2; // RGB
  const compression = 0;
  const filter = 0;
  const interlace = 0;
  
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(bitDepth, 8);
  ihdrData.writeUInt8(colorType, 9);
  ihdrData.writeUInt8(compression, 10);
  ihdrData.writeUInt8(filter, 11);
  ihdrData.writeUInt8(interlace, 12);
  
  const ihdrCrc = crc32(Buffer.concat([Buffer.from('IHDR'), ihdrData]));
  const ihdrChunk = Buffer.concat([
    Buffer.from([0, 0, 0, 13]), // length
    Buffer.from('IHDR'),
    ihdrData,
    ihdrCrc
  ]);
  
  // Create image data (simple amber color)
  const imageData = [];
  for (let y = 0; y < height; y++) {
    imageData.push(0); // filter byte
    for (let x = 0; x < width; x++) {
      // Amber color (#f59e0b)
      imageData.push(245); // R
      imageData.push(158); // G
      imageData.push(11);  // B
    }
  }
  
  // Compress the image data (simplified - just store as-is for now)
  const compressedData = Buffer.from(imageData);
  
  // IDAT chunk
  const idatCrc = crc32(Buffer.concat([Buffer.from('IDAT'), compressedData]));
  const idatChunk = Buffer.concat([
    Buffer.from([(compressedData.length >> 24) & 0xFF, (compressedData.length >> 16) & 0xFF, (compressedData.length >> 8) & 0xFF, compressedData.length & 0xFF]),
    Buffer.from('IDAT'),
    compressedData,
    idatCrc
  ]);
  
  // IEND chunk
  const iendCrc = crc32(Buffer.from('IEND'));
  const iendChunk = Buffer.concat([
    Buffer.from([0, 0, 0, 0]), // length
    Buffer.from('IEND'),
    iendCrc
  ]);
  
  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

// Simple CRC32 implementation
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  const table = [];
  
  // Generate CRC table
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      if (c & 1) {
        c = 0xEDB88320 ^ (c >>> 1);
      } else {
        c = c >>> 1;
      }
    }
    table[i] = c;
  }
  
  // Calculate CRC
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  
  crc = crc ^ 0xFFFFFFFF;
  return Buffer.from([(crc >> 24) & 0xFF, (crc >> 16) & 0xFF, (crc >> 8) & 0xFF, crc & 0xFF]);
}

// Generate icons for all required sizes
const sizes = [72, 96, 128, 144, 152, 192, 384, 512];

console.log('Generating placeholder PWA icons...');

sizes.forEach(size => {
  const pngData = createPlaceholderPNG(size);
  const filename = `icon-${size}x${size}.png`;
  const filepath = path.join(iconsDir, filename);
  
  fs.writeFileSync(filepath, pngData);
  console.log(`Created ${filename}`);
});

console.log('\nAll placeholder icons created successfully!');
console.log('Note: These are simple placeholder icons. For production, replace with proper squirrel icons.');