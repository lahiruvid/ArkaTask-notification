import sharp from "sharp";
import { writeFileSync, copyFileSync } from "fs";

function svg(size) {
  const stroke = size * 0.0625;
  const rays = [0, 45, 90, 135, 180, 225, 270, 315]
    .map((deg) => {
      const rad = (deg * Math.PI) / 180;
      const cx = size / 2;
      const cy = size / 2;
      const inner = size * 0.22;
      const outer = size * 0.32;
      const x1 = cx + Math.sin(rad) * inner;
      const y1 = cy - Math.cos(rad) * inner;
      const x2 = cx + Math.sin(rad) * outer;
      const y2 = cy - Math.cos(rad) * outer;
      return `<path d="M${x1} ${y1}L${x2} ${y2}"/>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="${size}" y2="${size}">
      <stop stop-color="#f59e0b"/>
      <stop offset="1" stop-color="#ea580c"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" fill="url(#g)"/>
  <g stroke="#fff" stroke-width="${stroke}" stroke-linecap="round" fill="none">
    <circle cx="${size / 2}" cy="${size / 2}" r="${size * 0.156}"/>
    ${rays}
  </g>
</svg>`;
}

async function writePng(size, path) {
  const buf = await sharp(Buffer.from(svg(size))).png().toBuffer();
  writeFileSync(path, buf);
  console.log("wrote", path, `${size}x${size}`, buf.length);
}

await writePng(180, "public/apple-touch-icon.png");
await writePng(180, "src/app/apple-icon.png");
await writePng(192, "public/icon-192.png");
await writePng(192, "src/app/icon.png");
await writePng(512, "public/icon-512.png");
await writePng(32, "public/icon-32.png");

// favicon.ico: prefer to-ico, else copy 32png for browsers that tolerate it poorly
try {
  const toIco = (await import("to-ico")).default;
  const sizes = [16, 32, 48];
  const pngs = await Promise.all(
    sizes.map((s) => sharp(Buffer.from(svg(s))).png().toBuffer())
  );
  const ico = await toIco(pngs);
  writeFileSync("public/favicon.ico", ico);
  writeFileSync("src/app/favicon.ico", ico);
  console.log("wrote favicon.ico");
} catch {
  copyFileSync("public/icon-32.png", "public/favicon.ico");
  console.log("to-ico unavailable — copied 32png as favicon.ico placeholder");
}
