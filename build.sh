#!/bin/bash

echo "🚀 Setting up EaglercraftX 1.8..."

# Clean and create dist directory
rm -rf dist
mkdir -p dist

# Download EaglercraftX 1.8 directly
echo "📦 Downloading EaglercraftX 1.8..."
cd dist
wget -q https://github.com/lax1dude/eaglercraft/releases/download/v1.8.8/EaglercraftX_1.8.zip
unzip -q EaglercraftX_1.8.zip
rm EaglercraftX_1.8.zip

# Create a simple navigation page
echo "📝 Creating navigation page..."
cat > index.html << 'EOF'
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Eaglercraft Minecraft</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Minecraft', Arial, sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            color: white;
            min-height: 100vh;
            padding: 20px;
            text-align: center;
        }
        
        .container {
            max-width: 1000px;
            margin: 0 auto;
            padding: 20px;
        }
        
        header {
            padding: 40px 20px;
            background: rgba(0, 0, 0, 0.3);
            border-radius: 15px;
            margin-bottom: 40px;
            border: 2px solid #4CAF50;
            box-shadow: 0 0 30px rgba(76, 175, 80, 0.3);
        }
        
        h1 {
            font-size: 3rem;
            color: #4CAF50;
            margin-bottom: 10px;
            text-shadow: 0 0 10px rgba(76, 175, 80, 0.7);
        }
        
        .tagline {
            font-size: 1.2rem;
            color: #aaa;
            margin-bottom: 30px;
        }
        
        .game-options {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 25px;
            margin-bottom: 40px;
        }
        
        .option-card {
            background: rgba(30, 30, 46, 0.8);
            border-radius: 12px;
            padding: 30px;
            text-decoration: none;
            color: white;
            transition: all 0.3s ease;
            border: 2px solid transparent;
        }
        
        .option-card:hover {
            transform: translateY(-5px);
            border-color: #4CAF50;
            box-shadow: 0 10px 25px rgba(76, 175, 80, 0.2);
        }
        
        .option-icon {
            font-size: 3rem;
            margin-bottom: 15px;
            display: block;
        }
        
        .option-title {
            font-size: 1.8rem;
            margin-bottom: 10px;
            color: #4CAF50;
        }
        
        .option-desc {
            color: #aaa;
            line-height: 1.6;
            margin-bottom: 20px;
        }
        
        .play-btn {
            display: inline-block;
            background: #4CAF50;
            color: white;
            padding: 12px 25px;
            border-radius: 8px;
            text-decoration: none;
            font-weight: bold;
            transition: background 0.3s;
        }
        
        .play-btn:hover {
            background: #45a049;
        }
        
        .server-list {
            background: rgba(0, 0, 0, 0.2);
            border-radius: 12px;
            padding: 25px;
            margin-top: 40px;
        }
        
        .server-ip {
            background: rgba(255, 255, 255, 0.1);
            padding: 15px;
            border-radius: 8px;
            margin: 10px 0;
            font-family: monospace;
            word-break: break-all;
        }
        
        .note {
            background: rgba(255, 193, 7, 0.1);
            border-left: 4px solid #ffc107;
            padding: 15px;
            margin: 20px 0;
            text-align: left;
            border-radius: 0 8px 8px 0;
        }
        
        @media (max-width: 768px) {
            .game-options {
                grid-template-columns: 1fr;
            }
            
            h1 {
                font-size: 2.2rem;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>🛠️ EAGLERCRAFT</h1>
            <p class="tagline">Minecraft 1.8 in your browser • No downloads • Free to play</p>
        </header>
        
        <div class="game-options">
            <a href="singleplayer.html" class="option-card">
                <span class="option-icon">🎮</span>
                <h2 class="option-title">Single Player</h2>
                <p class="option-desc">Play Minecraft offline by yourself. Create worlds, build, explore, and survive.</p>
                <span class="play-btn">Play Offline</span>
            </a>
            
            <a href="multiplayer.html" class="option-card">
                <span class="option-icon">🌐</span>
                <h2 class="option-title">Multiplayer</h2>
                <p class="option-desc">Connect to multiplayer servers and play with friends online.</p>
                <span class="play-btn">Play Online</span>
            </a>
            
            <a href="client.html" class="option-card">
                <span class="option-icon">⚡</span>
                <h2 class="option-title">Direct Client</h2>
                <p class="option-desc">Launch the full Eaglercraft client with all features.</p>
                <span class="play-btn">Launch Client</span>
            </a>
        </div>
        
        <div class="note">
            <strong>⚠️ Note:</strong> Eaglercraft runs entirely in your browser. No Java or Minecraft account required. 
            The game saves automatically to your browser's local storage.
        </div>
        
        <div class="server-list">
            <h2>🌐 Popular Server IPs</h2>
            <p>Try connecting to these servers:</p>
            
            <div class="server-ip">
                <strong>play.eaglercraft.com:8081</strong> - Official Eaglercraft Server
            </div>
            
            <div class="server-ip">
                <strong>mc.eaglercraft.net:8081</strong> - Community Server
            </div>
            
            <p style="margin-top: 20px; color: #aaa;">
                To connect: Click "Multiplayer" → "Add Server" → Enter IP and Port
            </p>
        </div>
        
        <footer style="margin-top: 50px; color: #666; font-size: 0.9rem;">
            <p>Eaglercraft is a web-based implementation of Minecraft 1.8. Not affiliated with Mojang or Microsoft.</p>
            <p>Powered by Cloudflare Workers • Version 1.8.8</p>
        </footer>
    </div>
</body>
</html>
EOF

echo "✅ EaglercraftX setup complete!"
echo "📁 Files are ready in the dist/ directory"