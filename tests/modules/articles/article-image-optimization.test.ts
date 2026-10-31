import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { optimizeArticleImage } from "@/src/modules/articles/article-image-optimization.service";

// Distinct corner markers expose any crop or rotation of the sharp foreground.
async function sourceImage(width: number, height: number) {
  const marker = Math.round(Math.min(width, height) / 5);
  const colors = ["#ff0000", "#00ff00", "#0000ff", "#ffff00"];
  const patches = await Promise.all(colors.map(background => sharp({ create: { width: marker, height: marker, channels: 3, background } }).png().toBuffer()));
  return sharp({ create: { width, height, channels: 3, background: "#dddddd" } }).composite(patches.map((input, i) => ({input, left: i % 2 ? width-marker : 0, top: i > 1 ? height-marker : 0}))).png().toBuffer();
}

async function pixel(bytes: Buffer, x: number, y: number) {
  return Array.from(await sharp(bytes).extract({left:x,top:y,width:1,height:1}).removeAlpha().raw().toBuffer());
}

function near(actual: number[], expected: number[]) {
  actual.forEach((v,i) => expect(Math.abs(v-expected[i])).toBeLessThan(18));
}

describe("canonical article AVIF", () => {
  it.each([[1920,1080], [1080,1920], [1200,1200], [2400,1000], [800,1400]])(
    "contains every corner of %i × %i in a 1600 × 900 AVIF", async (w,h) => {
      const output = await optimizeArticleImage(await sourceImage(w,h));
      const meta = await sharp(output.bytes).metadata();
      expect(meta.compression).toBe("av1");
      expect([meta.width, meta.height]).toEqual([1600,900]);
      expect(output).toMatchObject({format:"avif", mimeType:"image/avif", aspectRatio:16/9, fileSize:output.bytes.length});
      const scale=Math.min(1600/w,900/h);
      const width=Math.round(w*scale), height=Math.round(h*scale);
      const left=Math.floor((1600-width)/2), top=Math.floor((900-height)/2);
      const inset=Math.round(Math.min(w,h)*scale/10);
      for (const [i,color] of [[255,0,0],[0,255,0],[0,0,255],[255,255,0]].entries()) {
        near(await pixel(output.bytes, left+(i%2 ? width-inset : inset), top+(i>1 ? height-inset : inset)),color);
      }
    },30000,
  );

  it("normalizes EXIF orientation and removes private metadata", async () => {
    const input=await sharp(await sourceImage(1200,800)).jpeg().withMetadata({orientation:6}).toBuffer();
    const output=await optimizeArticleImage(input);
    const meta=await sharp(output.bytes).metadata();
    expect(meta.orientation).toBeUndefined();
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    // Orientation 6 rotates the bottom-left blue corner to top-left.
    near(await pixel(output.bytes, 550,60),[0,0,255]);
    near(await pixel(output.bytes,1050,60),[255,0,0]);
  });

  it("preserves transparent source alpha while compositing",async()=>{
    const source=await sharp({create:{width:1600,height:900,channels:4,background:{r:50,g:90,b:130,alpha:0.5}}}).png().toBuffer();
    const out=await optimizeArticleImage(source);
    expect((await sharp(out.bytes).metadata()).hasAlpha).toBe(true);
  });

  it("rejects forged headers and truncated images",async()=>{
    await expect(optimizeArticleImage(Buffer.from([137,80,78,71,13,10,26,10]))).rejects.toThrow();
    const bytes=await sharp(await sourceImage(100,100)).jpeg().toBuffer();
    await expect(optimizeArticleImage(bytes.subarray(0,bytes.length/2))).rejects.toThrow();
  });
});


describe("hero preset", () => {
  it("keeps a 1920 × 640 wide source intact and returns actual metadata", async () => {
    const out = await optimizeArticleImage(await sourceImage(1920,640), "ARTICLE_HERO");
    expect([out.width,out.height,out.aspectRatio]).toEqual([1920,640,3]);
    expect(out.fileSize).toBe(out.bytes.length);
    expect((await sharp(out.bytes).metadata()).compression).toBe("av1");
    near(await pixel(out.bytes,60,60),[255,0,0]);
    near(await pixel(out.bytes,1860,580),[255,255,0]);
  });
  it("contains the complete portrait inside the wide preset", async () => {
    const out = await optimizeArticleImage(await sourceImage(800,1400), "ARTICLE_HERO");
    expect([out.width,out.height]).toEqual([1920,640]);
    near(await pixel(out.bytes,800,30),[255,0,0]);
    near(await pixel(out.bytes,1120,610),[255,255,0]);
  });
});
