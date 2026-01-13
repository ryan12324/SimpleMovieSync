const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');

class TranscodeService {
  constructor(outputDir) {
    this.outputDir = outputDir;
    this.qualityPresets = {
      '360p': {
        resolution: '640x360',
        videoBitrate: '800k',
        audioBitrate: '96k',
        name: '360p'
      },
      '480p': {
        resolution: '854x480',
        videoBitrate: '1400k',
        audioBitrate: '128k',
        name: '480p'
      },
      '720p': {
        resolution: '1280x720',
        videoBitrate: '2800k',
        audioBitrate: '128k',
        name: '720p'
      },
      '1080p': {
        resolution: '1920x1080',
        videoBitrate: '5000k',
        audioBitrate: '192k',
        name: '1080p'
      }
    };
  }

  async transcodeMovie(movie, qualities, onProgress) {
    const movieDir = path.join(this.outputDir, movie.id);

    // Create directory for transcoded files
    if (!fs.existsSync(movieDir)) {
      fs.mkdirSync(movieDir, { recursive: true });
    }

    const transcodedQualities = [];
    const totalQualities = qualities.length;
    let completedQualities = 0;

    for (const quality of qualities) {
      const preset = this.qualityPresets[quality];
      if (!preset) {
        console.warn(`Unknown quality preset: ${quality}`);
        continue;
      }

      try {
        const outputPath = await this.transcodeToQuality(
          movie.path,
          movieDir,
          movie.id,
          preset,
          (progress) => {
            const overallProgress = ((completedQualities + progress / 100) / totalQualities) * 100;
            onProgress({
              currentQuality: quality,
              qualityProgress: progress,
              overallProgress: Math.round(overallProgress),
              completedQualities,
              totalQualities
            });
          }
        );

        transcodedQualities.push({
          quality: preset.name,
          path: outputPath,
          url: `/transcoded/${movie.id}/${path.basename(outputPath)}`
        });

        completedQualities++;
        onProgress({
          currentQuality: quality,
          qualityProgress: 100,
          overallProgress: Math.round((completedQualities / totalQualities) * 100),
          completedQualities,
          totalQualities
        });
      } catch (error) {
        console.error(`Failed to transcode ${quality}:`, error);
        throw error;
      }
    }

    // Generate HLS playlist for adaptive streaming
    await this.generateMasterPlaylist(movieDir, movie.id, transcodedQualities);

    return transcodedQualities;
  }

  transcodeToQuality(inputPath, outputDir, movieId, preset, onProgress) {
    return new Promise((resolve, reject) => {
      const outputFilename = `${movieId}_${preset.name}.mp4`;
      const outputPath = path.join(outputDir, outputFilename);

      ffmpeg(inputPath)
        .outputOptions([
          `-vf scale=${preset.resolution}:force_original_aspect_ratio=decrease,pad=${preset.resolution}:(ow-iw)/2:(oh-ih)/2`,
          `-c:v libx264`,
          `-preset medium`,
          `-b:v ${preset.videoBitrate}`,
          `-c:a aac`,
          `-b:a ${preset.audioBitrate}`,
          `-movflags +faststart`,
          `-y`
        ])
        .output(outputPath)
        .on('start', (commandLine) => {
          console.log(`Started transcoding ${preset.name}: ${commandLine}`);
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            onProgress(Math.round(progress.percent));
          }
        })
        .on('end', () => {
          console.log(`Completed transcoding ${preset.name}`);
          resolve(outputPath);
        })
        .on('error', (err) => {
          console.error(`Error transcoding ${preset.name}:`, err);
          reject(err);
        })
        .run();
    });
  }

  async generateMasterPlaylist(movieDir, movieId, qualities) {
    // Generate HLS segments for each quality
    const hlsDir = path.join(movieDir, 'hls');
    if (!fs.existsSync(hlsDir)) {
      fs.mkdirSync(hlsDir, { recursive: true });
    }

    const hlsQualities = [];

    for (const quality of qualities) {
      const qualityDir = path.join(hlsDir, quality.quality);
      if (!fs.existsSync(qualityDir)) {
        fs.mkdirSync(qualityDir, { recursive: true });
      }

      try {
        await this.generateHLS(quality.path, qualityDir, quality.quality);
        hlsQualities.push({
          quality: quality.quality,
          bandwidth: this.getBandwidth(quality.quality),
          resolution: this.qualityPresets[quality.quality].resolution,
          url: `/transcoded/${movieId}/hls/${quality.quality}/playlist.m3u8`
        });
      } catch (error) {
        console.error(`Failed to generate HLS for ${quality.quality}:`, error);
      }
    }

    // Create master playlist
    let masterPlaylist = '#EXTM3U\n#EXT-X-VERSION:3\n';
    for (const q of hlsQualities) {
      masterPlaylist += `#EXT-X-STREAM-INF:BANDWIDTH=${q.bandwidth},RESOLUTION=${q.resolution}\n`;
      masterPlaylist += `${q.quality}/playlist.m3u8\n`;
    }

    fs.writeFileSync(path.join(hlsDir, 'master.m3u8'), masterPlaylist);

    return hlsQualities;
  }

  generateHLS(inputPath, outputDir, quality) {
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions([
          '-c:v copy',
          '-c:a copy',
          '-hls_time 10',
          '-hls_list_size 0',
          '-hls_segment_filename', path.join(outputDir, 'segment%03d.ts'),
          '-f hls'
        ])
        .output(path.join(outputDir, 'playlist.m3u8'))
        .on('end', () => {
          console.log(`Generated HLS for ${quality}`);
          resolve();
        })
        .on('error', (err) => {
          console.error(`Error generating HLS for ${quality}:`, err);
          reject(err);
        })
        .run();
    });
  }

  getBandwidth(quality) {
    const bandwidths = {
      '360p': 800000,
      '480p': 1400000,
      '720p': 2800000,
      '1080p': 5000000
    };
    return bandwidths[quality] || 1000000;
  }

  async getVideoInfo(inputPath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(inputPath, (err, metadata) => {
        if (err) {
          reject(err);
          return;
        }

        const videoStream = metadata.streams.find(s => s.codec_type === 'video');
        const audioStream = metadata.streams.find(s => s.codec_type === 'audio');

        resolve({
          duration: metadata.format.duration,
          size: metadata.format.size,
          bitrate: metadata.format.bit_rate,
          video: videoStream ? {
            codec: videoStream.codec_name,
            width: videoStream.width,
            height: videoStream.height,
            fps: eval(videoStream.r_frame_rate)
          } : null,
          audio: audioStream ? {
            codec: audioStream.codec_name,
            sampleRate: audioStream.sample_rate,
            channels: audioStream.channels
          } : null
        });
      });
    });
  }
}

module.exports = TranscodeService;
