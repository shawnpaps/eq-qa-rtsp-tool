import { Router } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { promises as fs } from 'fs';
import { getDb, saveDb, extractMetadata } from '../services/storage.js';
import { startStream, stopStream, getActiveStreams } from '../services/streamManager.js';

const router = Router();
const DATA_DIR = process.env.DATA_DIR || './data';
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    await fs.mkdir(UPLOADS_DIR, { recursive: true });
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } });

async function removeMediaMTXPath(slug) {
  try {
    const host = process.env.MEDIAMTX_INTERNAL_HOST || process.env.MEDIAMTX_HOST || 'mediamtx';
    const url = `http://${host}:9997/v3/paths/kick/${encodeURIComponent(slug)}`;
    const res = await fetch(url, { method: 'POST' });
    if (!res.ok && res.status !== 404) {
      console.error(`[MediaMTX] Failed to kick path ${slug}: ${res.status} ${res.statusText}`);
    }
  } catch (err) {
    console.error(`[MediaMTX] Failed to kick path ${slug}:`, err.message);
  }
}

router.post('/', async (req, res) => {
  try {
    const { name, sourceVideoId, fpsMode, customFps, loop } = req.body;
    const db = await getDb();
    const video = db.videos.find(v => v.id === sourceVideoId);
    if (!video) return res.status(404).json({ error: 'Video not found' });

    const slug = `stream-${uuidv4().slice(0, 8)}`;
    const internalHost = process.env.MEDIAMTX_INTERNAL_HOST || process.env.MEDIAMTX_HOST || 'mediamtx';
    const externalHost = process.env.MEDIAMTX_HOST || 'localhost';
    const port = process.env.MEDIAMTX_PORT || '8554';
    
    const stream = {
      id: uuidv4(),
      name,
      sourceVideoId,
      pathSlug: slug,
      fpsMode,
      customFps,
      loop: !!loop,
      status: 'idle',
      internalRtspUrl: `rtsp://${internalHost}:${port}/${slug}`,
      rtspUrl: `rtsp://${externalHost}:${port}/${slug}`,
      createdAt: new Date().toISOString()
    };

    db.streams.push(stream);
    await saveDb(db);
    res.json(stream);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', async (req, res) => {
  const db = await getDb();
  res.json(db.streams);
});

router.post('/:id/start', async (req, res) => {
  try {
    const db = await getDb();
    const stream = db.streams.find(s => s.id === req.params.id);
    if (!stream) return res.status(404).json({ error: 'Stream not found' });

    await startStream(stream);
    stream.status = 'running';
    await saveDb(db);

    res.json(stream);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/stop', async (req, res) => {
  try {
    const db = await getDb();
    const stream = db.streams.find(s => s.id === req.params.id);
    if (!stream) return res.status(404).json({ error: 'Stream not found' });

    await stopStream(stream.id);
    stream.status = 'stopped';
    await saveDb(db);

    res.json(stream);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/bulk-add', (req, res, next) => {
  upload.array('files[]')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File too large. Maximum file size is 500MB per file.' });
      }
      return res.status(400).json({ error: err.message });
    } else if (err) {
      return res.status(500).json({ error: err.message });
    }
    next();
  });
}, async (req, res) => {
  try {
    const files = req.files;
    const framerate = parseInt(req.body.framerate) || 30;
    const loop = req.body.loop === 'true';

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files provided' });
    }

    const db = await getDb();

    const maxIndex = db.streams.reduce((max, stream) => {
      const match = stream.pathSlug.match(/^test-stream-(\d+)$/);
      if (match) {
        const num = parseInt(match[1]);
        return Math.max(max, num);
      }
      return max;
    }, 0);

    let nextIndex = maxIndex + 1;

    const internalHost = process.env.MEDIAMTX_INTERNAL_HOST || process.env.MEDIAMTX_HOST || 'mediamtx';
    const externalHost = process.env.MEDIAMTX_HOST || 'localhost';
    const port = process.env.MEDIAMTX_PORT || '8554';

    const created = [];
    const errors = [];

    for (const file of files) {
      try {
        const metadata = await extractMetadata(file.path);

        const video = {
          id: uuidv4(),
          originalName: file.originalname,
          storedName: file.filename,
          filePath: file.path,
          durationSeconds: metadata.durationSeconds,
          width: metadata.width,
          height: metadata.height,
          nativeFps: metadata.fps,
          createdAt: new Date().toISOString()
        };

        const slug = `test-stream-${nextIndex}`;
        const stream = {
          id: uuidv4(),
          name: slug,
          sourceVideoId: video.id,
          pathSlug: slug,
          fpsMode: 'custom',
          customFps: framerate,
          loop: loop,
          status: 'starting',
          internalRtspUrl: `rtsp://${internalHost}:${port}/${slug}`,
          rtspUrl: `rtsp://${externalHost}:${port}/${slug}`,
          createdAt: new Date().toISOString()
        };

        db.videos.push(video);
        db.streams.push(stream);

        try {
          await startStream(stream);
          stream.status = 'running';
        } catch (spawnErr) {
          stream.status = 'error';
          errors.push({ file: file.originalname, error: spawnErr.message });
        }

        created.push(stream);
        nextIndex++;
      } catch (err) {
        errors.push({ file: file.originalname, error: err.message });
      }
    }

    await saveDb(db);

    res.json({ created, errors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/nuke-all', async (req, res) => {
  try {
    const db = await getDb();
    const activeStreams = getActiveStreams();

    for (const stream of db.streams) {
      const proc = activeStreams.get(stream.id);
      if (proc) {
        proc.kill('SIGTERM');
        activeStreams.delete(stream.id);

        await new Promise(resolve => setTimeout(resolve, 2000));
        if (!proc.killed) {
          proc.kill('SIGKILL');
        }
      }
    }

    for (const stream of db.streams) {
      await removeMediaMTXPath(stream.pathSlug);
    }

    for (const video of db.videos) {
      try {
        await fs.unlink(video.filePath);
      } catch (err) {
        console.error(`Failed to delete video file ${video.filePath}:`, err.message);
      }
    }

    const removedStreams = db.streams.length;
    const removedVideos = db.videos.length;

    db.streams = [];
    db.videos = [];

    await saveDb(db);

    res.json({
      removed: {
        streams: removedStreams,
        videos: removedVideos
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const db = await getDb();
    const stream = db.streams.find(s => s.id === req.params.id);
    if (stream) {
      await stopStream(stream.id);
      await removeMediaMTXPath(stream.pathSlug);
    }
    db.streams = db.streams.filter(s => s.id !== req.params.id);
    await saveDb(db);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
