import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ToastProvider } from './components/Toast.jsx';
import Feed from './pages/Feed.jsx';
import Playlist from './pages/Playlist.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <Routes>
          <Route path="/" element={<Feed />} />
          <Route path="/playlist" element={<Playlist />} />
        </Routes>
      </ToastProvider>
    </BrowserRouter>
  );
}
