const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Enable CORS for your frontend
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Explicitly serve index.html at root
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// Main search endpoint using Anthropic API
app.post('/api/search-dexa-facilities', async (req, res) => {
  const { address } = req.body;
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'Anthropic API key not configured. Please add ANTHROPIC_API_KEY to your .env file' });
  }

  try {
    // Step 1: Get coordinates for the address
    const geocodeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: `What are the GPS coordinates (latitude and longitude) for this address: "${address}"? Reply with ONLY a JSON object like {"latitude": 37.7749, "longitude": -122.4194} with no other text.`
        }]
      })
    });

    const geocodeData = await geocodeResponse.json();
    console.log('Geocode response status:', geocodeResponse.status);
    console.log('Geocode data:', JSON.stringify(geocodeData).slice(0, 500));
    let userCoords = null;
    
    if (geocodeData.content && geocodeData.content[0]) {
      try {
        const coordText = geocodeData.content[0].text;
        const jsonMatch = coordText.match(/\{[^}]+\}/);
        if (jsonMatch) {
          userCoords = JSON.parse(jsonMatch[0]);
        }
      } catch (e) {
        console.error('Error parsing coordinates:', e);
      }
    }

    if (!userCoords || !userCoords.latitude || !userCoords.longitude) {
      return res.status(400).json({ error: 'Could not find coordinates for that address. Please try a more specific address.' });
    }

    // Step 2: Search for DEXA facilities using Claude with places_search tool
    const searchResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 4000,
        messages: [{
          role: 'user',
          content: `Find facilities near ${address} that offer comprehensive body composition DEXA scans (also called DXA scans). These facilities should specifically offer detailed body composition analysis including lean mass, fat mass, bone density, and visceral fat measurements - not just basic bone density screening. Look for: "body composition DEXA", "full body DEXA scan", "DEXA body composition analysis", "body fat DEXA scan", fitness/wellness DEXA facilities, sports performance centers with DEXA. Return results as a JSON array where each facility has: name, address, phone (or null), rating (or null), latitude, longitude, website (or null). Return ONLY the JSON array with no other text.`
        }],
        tools: [{
          type: "places_search_20250110",
          name: "places_search"
        }]
      })
    });

    const searchData = await searchResponse.json();
    
    // Extract places from the response
    let allPlaces = [];
    
    if (searchData.content) {
      for (const block of searchData.content) {
        if (block.type === 'text') {
          try {
            const text = block.text.trim();
            const jsonMatch = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
            if (jsonMatch) {
              const places = JSON.parse(jsonMatch[0]);
              allPlaces = allPlaces.concat(places);
            }
          } catch (e) {
            console.error('Error parsing places JSON:', e);
          }
        }
        
        if (block.type === 'tool_result') {
          try {
            const resultContent = typeof block.content === 'string' 
              ? JSON.parse(block.content) 
              : block.content;
            
            if (resultContent.places && Array.isArray(resultContent.places)) {
              allPlaces = allPlaces.concat(resultContent.places);
            }
          } catch (e) {
            console.error('Error parsing tool result:', e);
          }
        }
      }
    }

    // Return results with user coordinates
    res.json({
      userLocation: userCoords,
      facilities: allPlaces
    });

  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Visit http://localhost:${PORT} to use the app`);
});
