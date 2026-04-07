import fs from "node:fs";
import OpenAI, { toFile } from "openai";
import { Buffer } from "node:buffer";

if (!process.env.AI_INTEGRATIONS_OPENAI_BASE_URL) {
  throw new Error(
    "AI_INTEGRATIONS_OPENAI_BASE_URL must be set. Did you forget to provision the OpenAI AI integration?",
  );
}

if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
  throw new Error(
    "AI_INTEGRATIONS_OPENAI_API_KEY must be set. Did you forget to provision the OpenAI AI integration?",
  );
}

export const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export async function generateImageBuffer(
  prompt: string,
  size: "1024x1024" | "512x512" | "256x256" = "1024x1024"
): Promise<Buffer> {
  const response = await openai.images.generate({
    model: "gpt-image-1",
    prompt,
    size,
  });
  if (!response.data || response.data.length === 0) {
    throw new Error("No image data returned from OpenAI API");
  }
  const base64 = response.data[0]?.b64_json;
  if (!base64) {
    throw new Error("OpenAI response missing b64_json field");
  }
  return Buffer.from(base64, "base64");
}

export async function editImages(
  imageFiles: string[],
  prompt: string,
  outputPath?: string
): Promise<Buffer> {
  try {
    const images = await Promise.all(
      imageFiles.map((file) =>
        toFile(fs.createReadStream(file), file, {
          type: "image/png",
        })
      )
    );

    const response = await openai.images.edit({
      model: "gpt-image-1",
      image: images,
      prompt,
    });

    if (!response.data || response.data.length === 0) {
      throw new Error("No image data returned from OpenAI API");
    }
    const imageBase64 = response.data[0]?.b64_json;
    if (!imageBase64) {
      throw new Error("No base64 data in OpenAI response");
    }

    const imageBytes = Buffer.from(imageBase64, "base64");

    if (outputPath) {
      fs.writeFileSync(outputPath, imageBytes);
    }

    return imageBytes;
  } catch (error) {
    if (error instanceof Error && (error.message.includes("429") || error.message.includes("rate limit"))) {
      throw new Error("OpenAI rate limit exceeded. Please try again with fewer requests or after some time.");
    }
    throw new Error(`Image processing failed: ${error instanceof Error ? error.message : error}`);
  }
}