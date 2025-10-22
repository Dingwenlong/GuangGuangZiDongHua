import { spawn, exec } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname, basename } from 'path';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface VideoSplitOptions {
  /** Input video file path */
  videoPath: string;
  /** Output directory for clips */
  outputDir?: string;
  /** Base clip duration in seconds */
  clipDuration?: number;
  /** Scene change check duration in seconds */
  checkDuration?: number;
  /** Extended clip duration if same scene */
  extendedDuration?: number;
  /** Maximum number of clips to extract */
  maxClips?: number;
  /** Scene change detection threshold */
  sceneThreshold?: number;
  /** Path to ffmpeg executable (optional) */
  ffmpegPath?: string;
  /** Path to ffprobe executable (optional) */
  ffprobePath?: string;
}

export interface VideoSplitResult {
  success: boolean;
  clips: string[];
  totalClips: number;
  originalDuration: number;
  totalClipsDuration: number;
  outputDir: string;
  error?: string;
}

export class VideoSceneSplitter {
  private ffmpegPath: string;
  private ffprobePath: string;

  constructor(ffmpegPath: string = 'ffmpeg', ffprobePath: string = 'ffprobe') {
    this.ffmpegPath = ffmpegPath;
    this.ffprobePath = ffprobePath;
  }

  /**
   * Split video into scenes based on scene change detection
   */
  async splitVideo(options: VideoSplitOptions): Promise<VideoSplitResult> {
    const {
      videoPath,
      outputDir,
      clipDuration = 4,
      checkDuration = 2,
      extendedDuration = 5,
      maxClips = 4,
      sceneThreshold = 0.3
    } = options;

    // Validate input file
    if (!existsSync(videoPath)) {
      throw new Error(`Input video file does not exist: ${videoPath}`);
    }

    // Set default output directory if not provided
    const finalOutputDir = outputDir || 
      join(dirname(videoPath), 'scene_clips');

    // Create output directory if it doesn't exist
    if (!existsSync(finalOutputDir)) {
      mkdirSync(finalOutputDir, { recursive: true });
    }

    try {
      // Get video duration and audio info
      const videoInfo = await this.getVideoInfo(videoPath);
      const hasAudio = await this.hasAudioStream(videoPath);

      console.log(`Video duration: ${videoInfo.duration} seconds`);
      console.log(`Video has audio: ${hasAudio}`);

      // Initialize variables
      let currentTime = 0;
      let clipCount = 0;
      const outputFiles: string[] = [];

      // Main processing loop
      while (currentTime < videoInfo.duration && clipCount < maxClips) {
        const remainingTime = videoInfo.duration - currentTime;

        // Check if this is the last clip
        const isLastClip = (clipCount + 1 === maxClips) || 
          (remainingTime <= (clipDuration + 0.5));

        let actualClipDuration: number;

        if (isLastClip) {
          // For the last clip, use all remaining time
          actualClipDuration = remainingTime;
          console.log(`Last clip detected. Using all remaining time: ${actualClipDuration} seconds`);
        } else {
          if (remainingTime < clipDuration) {
            console.log(`Remaining video too short for base clip. Using remaining time: ${remainingTime} seconds`);
            actualClipDuration = remainingTime;
          } else {
            // Calculate actual clip duration
            actualClipDuration = clipDuration;

            // Check if we can test for scene change
            if (remainingTime >= (clipDuration + checkDuration)) {
              const sceneCheckTime = currentTime + clipDuration;

              console.log(`Checking for scene change from ${sceneCheckTime} to ${sceneCheckTime + checkDuration} seconds`);

              // Test for scene change
              const hasSceneChange = await this.testSceneChange(
                videoPath,
                sceneCheckTime,
                checkDuration,
                sceneThreshold,
                finalOutputDir,
                clipCount
              );

              if (!hasSceneChange) {
                actualClipDuration = extendedDuration;
                console.log(`No scene change detected. Extending clip to ${extendedDuration} seconds`);
              } else {
                console.log(`Scene change detected. Keeping clip at ${clipDuration} seconds`);
              }
            } else {
              console.log(`Not enough video remaining for scene check. Using base duration.`);
            }
          }
        }

        // Ensure we don't exceed video duration
        if ((currentTime + actualClipDuration) > videoInfo.duration) {
          actualClipDuration = videoInfo.duration - currentTime;
          console.log(`Adjusting clip duration to fit remaining video: ${actualClipDuration} seconds`);
        }

        // Generate output filename
        const outputFile = join(finalOutputDir, `scene_${clipCount + 1}.mp4`);

        console.log(`Extracting clip ${clipCount + 1}: ${currentTime} to ${currentTime + actualClipDuration} seconds`);

        // Extract clip
        const success = await this.extractClip(
          videoPath,
          currentTime,
          actualClipDuration,
          outputFile,
          hasAudio
        );

        if (success) {
          // Verify the created clip
          const clipInfo = await this.getVideoInfo(outputFile);
          const clipHasAudio = await this.hasAudioStream(outputFile);

          console.log(`Verified clip duration: ${clipInfo.duration} seconds`);
          console.log(`Output clip has audio: ${clipHasAudio}`);

          outputFiles.push(outputFile);
          clipCount++;
        } else {
          console.error(`Failed to create clip: ${outputFile}`);
        }

        // Move to next segment
        currentTime += actualClipDuration;

        console.log('---');

        // Break if we've reached the end of the video
        if (currentTime >= videoInfo.duration) {
          console.log('Reached end of video.');
          break;
        }
      }

      // Calculate total duration of all clips
      let totalClipDuration = 0;
      for (const file of outputFiles) {
        const clipInfo = await this.getVideoInfo(file);
        totalClipDuration += clipInfo.duration;
      }

      return {
        success: true,
        clips: outputFiles,
        totalClips: clipCount,
        originalDuration: videoInfo.duration,
        totalClipsDuration: totalClipDuration,
        outputDir: finalOutputDir
      };

    } catch (error) {
      return {
        success: false,
        clips: [],
        totalClips: 0,
        originalDuration: 0,
        totalClipsDuration: 0,
        outputDir: finalOutputDir,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Get video duration and other info using ffprobe
   */
  private async getVideoInfo(videoPath: string): Promise<{ duration: number }> {
    const command = `"${this.ffprobePath}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`;
    
    try {
      const { stdout } = await execAsync(command);
      const duration = parseFloat(stdout.trim());
      return { duration };
    } catch (error) {
      throw new Error(`Failed to get video info: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Check if video has audio stream
   */
  private async hasAudioStream(videoPath: string): Promise<boolean> {
    const command = `"${this.ffprobePath}" -v error -select_streams a -show_entries stream=codec_type -of csv=p=0 "${videoPath}"`;
    
    try {
      const { stdout } = await execAsync(command);
      return stdout.includes('audio');
    } catch (error) {
      // If command fails, assume no audio
      return false;
    }
  }

  /**
   * Detect scene change using ffmpeg
   */
  private async testSceneChange(
    videoPath: string,
    startTime: number,
    checkDuration: number,
    threshold: number,
    outputDir: string,
    clipCount: number
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const args = [
        '-ss', startTime.toString(),
        '-i', `"${videoPath}"`,
        '-t', checkDuration.toString(),
        '-vf', `select=gt(scene\\,${threshold})`,
        '-an',
        '-f', 'null',
        '-'
      ];

      const ffmpeg = spawn(this.ffmpegPath, args, { 
        shell: true,
        stdio: ['ignore', 'ignore', 'pipe']
      });

      let stderrData = '';

      ffmpeg.stderr.on('data', (data) => {
        stderrData += data.toString();
      });

      ffmpeg.on('close', () => {
        // Count scene change detections
        const sceneChangeCount = (stderrData.match(/scene:([\d.]+)/g) || []).length;
        resolve(sceneChangeCount > 0);
      });

      ffmpeg.on('error', () => {
        resolve(false);
      });
    });
  }

  /**
   * Extract video clip using ffmpeg
   */
  private async extractClip(
    videoPath: string,
    startTime: number,
    duration: number,
    outputFile: string,
    hasAudio: boolean
  ): Promise<boolean> {
    const baseArgs = [
      '-ss', startTime.toString(),
      '-i', `"${videoPath}"`,
      '-t', duration.toString(),
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '23',
      '-avoid_negative_ts', 'make_zero',
      '-fflags', '+genpts'
    ];

    // Add audio parameters if video has audio
    if (hasAudio) {
      baseArgs.push('-c:a', 'aac', '-b:a', '128k');
    } else {
      baseArgs.push('-an');
    }

    baseArgs.push(`"${outputFile}"`);

    try {
      const { stdout, stderr } = await execAsync(`"${this.ffmpegPath}" ${baseArgs.join(' ')}`);
      return true;
    } catch (error) {
      console.error(`FFmpeg error: ${error}`);
      return false;
    }
  }
}

// Usage example:
/*
const splitter = new VideoSceneSplitter();

const result = await splitter.splitVideo({
  videoPath: 'C:/path/to/video.mp4',
  outputDir: 'C:/output/clips',
  clipDuration: 4,
  checkDuration: 2,
  extendedDuration: 5,
  maxClips: 4,
  sceneThreshold: 0.3
});

if (result.success) {
  console.log('Processing completed!');
  console.log(`Total clips created: ${result.totalClips}`);
  console.log(`Original video duration: ${result.originalDuration} seconds`);
  console.log(`Total clips duration: ${result.totalClipsDuration} seconds`);
  console.log(`Output directory: ${result.outputDir}`);
  console.log('Output files:');
  result.clips.forEach(file => console.log(`  ${basename(file)}`));
} else {
  console.error(`Error: ${result.error}`);
}
*/