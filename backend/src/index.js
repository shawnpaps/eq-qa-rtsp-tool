import express from 'express';
import cors from 'cors';
import videoRoutes from './routes/videos.js';
import streamRoutes from './routes/streams.js';
import systemRoutes from './routes/system.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());

app.use('/videos', videoRoutes);
app.use('/streams', streamRoutes);
app.use('/system', systemRoutes);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend server running on port ${PORT}`);
});
