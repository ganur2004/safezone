/**
 * Amazon Polly text to speech (SPEC 7.1). When Polly is not configured the
 * endpoint says so with 503 and the simulator falls back to the browser's own
 * speechSynthesis, so the demo always has a voice.
 */
import { PollyClient, SynthesizeSpeechCommand } from "@aws-sdk/client-polly";
import { config } from "./config.js";

let client: PollyClient | undefined;

export class TtsUnavailableError extends Error {}

/** Polly's neural voices are the ones that sound like Alexa (SPEC 8.2). */
export async function synthesize(text: string): Promise<Uint8Array> {
  if (!config.pollyEnabled) {
    throw new TtsUnavailableError("Polly is disabled on this server");
  }
  client ??= new PollyClient({ region: config.awsRegion });
  try {
    const response = await client.send(
      new SynthesizeSpeechCommand({
        Text: text,
        OutputFormat: "mp3",
        VoiceId: config.pollyVoiceId as never,
        Engine: "neural",
        LanguageCode: "en-US",
      }),
    );
    if (!response.AudioStream) throw new TtsUnavailableError("Polly returned no audio");
    return await response.AudioStream.transformToByteArray();
  } catch (error) {
    if (error instanceof TtsUnavailableError) throw error;
    throw new TtsUnavailableError(`Polly failed: ${(error as Error).message}`);
  }
}
