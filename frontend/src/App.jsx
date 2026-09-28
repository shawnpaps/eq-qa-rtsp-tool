import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import TopBar from './components/TopBar';
import UploadDropzone from './components/UploadDropzone';
import VideoLibrary from './components/VideoLibrary';
import StreamGrid from './components/StreamGrid';
import BulkTestStreams from './components/BulkTestStreams';

const API_URL = import.meta.env.VITE_API_URL || '';

export default function App() {
  const [videos, setVideos] = useState([]);
  const [streams, setStreams] = useState([]);
  const [ipv4, setIpv4] = useState('');
  const [activeTab, setActiveTab] = useState('videos');

  useEffect(() => {
    fetchVideos();
    fetchStreams();
    fetchIpv4();
  }, []);

  const fetchVideos = async () => {
    const res = await fetch(`${API_URL}/videos`);
    if (res.ok) setVideos(await res.json());
  };

  const fetchStreams = async () => {
    const res = await fetch(`${API_URL}/streams`);
    if (res.ok) setStreams(await res.json());
  };

  const fetchIpv4 = async () => {
    const res = await fetch(`${API_URL}/system/ip`);
    if (res.ok) {
      const data = await res.json();
      setIpv4(data.ipv4);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <TopBar ipv4={ipv4} />
      
      <main className="container mx-auto px-4 py-8 max-w-6xl">
        <BulkTestStreams
          streams={streams}
          videos={videos}
          apiUrl={API_URL}
          onUpdate={() => {
            fetchVideos();
            fetchStreams();
          }}
        />

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <UploadDropzone onUpload={fetchVideos} apiUrl={API_URL} />
        </motion.div>

        <div className="flex gap-4 mb-6">
          <button
            onClick={() => setActiveTab('videos')}
            className={`px-4 py-2 rounded-xl transition-all ${
              activeTab === 'videos'
                ? 'bg-white/10 backdrop-blur-md text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Videos ({videos.length})
          </button>
          <button
            onClick={() => setActiveTab('streams')}
            className={`px-4 py-2 rounded-xl transition-all ${
              activeTab === 'streams'
                ? 'bg-white/10 backdrop-blur-md text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Streams ({streams.length})
          </button>
        </div>

        <AnimatePresence mode="wait">
          {activeTab === 'videos' ? (
            <motion.div
              key="videos"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <VideoLibrary
                videos={videos}
                onDelete={fetchVideos}
                apiUrl={API_URL}
                onCreateStream={fetchStreams}
              />
            </motion.div>
          ) : (
            <motion.div
              key="streams"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <StreamGrid
                streams={streams}
                videos={videos}
                apiUrl={API_URL}
                onUpdate={fetchStreams}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
