import { FFmpeg } from "@ffmpeg/ffmpeg";
import { Input, ALL_FORMATS, BlobSource, VideoSampleSink } from "mediabunny";

let ffmpeg: FFmpeg | null = null;

export const initFFmpeg = async (): Promise<FFmpeg> => {
  if (ffmpeg) return ffmpeg;

  ffmpeg = new FFmpeg();
  await ffmpeg.load(); // Use default config

  return ffmpeg;
};

export async function generateThumbnail({
  videoFile,
  timeInSeconds,
}: {
  videoFile: File;
  timeInSeconds: number;
}): Promise<string> {
  const input = new Input({
    source: new BlobSource(videoFile),
    formats: ALL_FORMATS,
  });

  const videoTrack = await input.getPrimaryVideoTrack();
  if (!videoTrack) {
    throw new Error("No video track found in the file");
  }

  // Check if we can decode this video
  const canDecode = await videoTrack.canDecode();
  if (!canDecode) {
    throw new Error("Video codec not supported for decoding");
  }

  const sink = new VideoSampleSink(videoTrack);

  const frame = await sink.getSample(timeInSeconds);

  if (!frame) {
    throw new Error("Could not get frame at specified time");
  }

  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 240;
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Could not get canvas context");
  }

  frame.draw(ctx, 0, 0, 320, 240);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(URL.createObjectURL(blob));
        } else {
          reject(new Error("Failed to create thumbnail blob"));
        }
      },
      "image/jpeg",
      0.8
    );
  });
}

export async function getVideoInfo({
  videoFile,
}: {
  videoFile: File;
}): Promise<{
  duration: number;
  width: number;
  height: number;
  fps: number;
}> {
  const input = new Input({
    source: new BlobSource(videoFile),
    formats: ALL_FORMATS,
  });

  const duration = await input.computeDuration();
  const videoTrack = await input.getPrimaryVideoTrack();

  if (!videoTrack) {
    throw new Error("No video track found in the file");
  }

  // Get frame rate from packet statistics
  const packetStats = await videoTrack.computePacketStats(100);
  const fps = packetStats.averagePacketRate;

  return {
    duration,
    width: videoTrack.displayWidth,
    height: videoTrack.displayHeight,
    fps,
  };
}

const generateSilentAudio = async (durationSeconds: number): Promise<Blob> => {
  const ffmpeg = await initFFmpeg();
  const outputName = "silent.wav";

  try {
    await ffmpeg.exec([
      "-f",
      "lavfi",
      "-i",
      `anullsrc=channel_layout=stereo:sample_rate=44100`,
      "-t",
      durationSeconds.toString(),
      "-c:a",
      "pcm_s16le",
      outputName,
    ]);

    const data = await ffmpeg.readFile(outputName);
    const blob = new Blob([data], { type: "audio/wav" });

    return blob;
  } catch (error) {
    console.error("Failed to generate silent audio:", error);
    throw error;
  } finally {
    try {
      await ffmpeg.deleteFile(outputName);
    } catch (cleanupError) {
      // Silent cleanup
    }
  }
};
