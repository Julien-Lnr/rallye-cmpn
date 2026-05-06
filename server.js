const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

// Servir les fichiers statiques
app.use(express.static('.'));

// Route pour proxifier les images
app.get('/proxy-image', async (req, res) => {
  const imageUrl = req.query.url;
  
  if (!imageUrl) {
    return res.status(400).json({ error: 'URL parameter required' });
  }

  try {
    console.log(`📥 Proxying image: ${imageUrl}`);
    
    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000
    });

    if (!response.ok) {
      return res.status(response.status).json({ 
        error: `Failed to fetch image: ${response.statusText}` 
      });
    }

    const contentType = response.headers.get('content-type');
    const buffer = await response.buffer();

    res.set('Content-Type', contentType || 'image/jpeg');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Cache-Control', 'public, max-age=86400');
    
    console.log(`✓ Image proxy success: ${imageUrl.substring(0, 50)}...`);
    res.send(buffer);
    
  } catch (error) {
    console.error(`✗ Proxy error for ${imageUrl}:`, error.message);
    res.status(500).json({ 
      error: `Failed to fetch image: ${error.message}` 
    });
  }
});

// Options CORS
app.options('*', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.send();
});

app.listen(PORT, () => {
  console.log(`\n🚀 Serveur Rallye CMPN démarré sur http://localhost:${PORT}\n`);
  console.log(`📺 Ouvrez: http://localhost:${PORT}\n`);
});
