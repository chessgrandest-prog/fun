const fs = require('fs');
const path = require('path');
const https = require('https');

const moviesFile = path.join(__dirname, 'movies.json');
const outDir = path.join(__dirname, 'movie-thumbnails');

if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir);
}

let movies = [];
try {
    movies = JSON.parse(fs.readFileSync(moviesFile, 'utf8'));
} catch (e) {
    console.error("Failed to read movies.json:", e);
    process.exit(1);
}

function downloadImage(url, dest) {
    return new Promise((resolve, reject) => {
        if (!url || !url.startsWith('http')) {
            resolve(false);
            return;
        }
        
        const req = https.get(url, (res) => {
            if (res.statusCode !== 200) {
                req.destroy();
                reject(new Error(`Status: ${res.statusCode}`));
                return;
            }
            
            const file = fs.createWriteStream(dest);
            res.pipe(file);
            file.on('finish', () => {
                file.close(() => resolve(true));
            });
            file.on('error', (err) => {
                fs.unlink(dest, () => reject(err));
            });
        });
        
        req.on('error', (err) => reject(err));
        
        // Timeout
        req.setTimeout(10000, () => {
            req.destroy();
            reject(new Error("Timeout"));
        });
    });
}

// Ensure valid filename
function safeFilename(str) {
    return str.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

async function run() {
    console.log(`Found ${movies.length} movies. Starting download...`);
    let downloaded = 0;
    let failed = 0;
    let updatedMovies = [];

    // Process in batches
    const BATCH_SIZE = 10;
    for (let i = 0; i < movies.length; i += BATCH_SIZE) {
        const batch = movies.slice(i, i + BATCH_SIZE);
        
        const promises = batch.map(async (movie) => {
            const ext = '.webp'; // Assume webp or generic for google content, we'll just save as .webp
            const filename = safeFilename(movie.title) + ext;
            const dest = path.join(outDir, filename);
            
            try {
                // Check if already downloaded
                if (!fs.existsSync(dest)) {
                    await downloadImage(movie.image, dest);
                }
                
                movie.image = `https://raw.githubusercontent.com/chessgrandest-prog/fun/main/site/movie-thumbnails/${filename}`;
                downloaded++;
            } catch (err) {
                // If it fails, leave the original image or try fallback
                console.log(`[Error] Failed to download for "${movie.title}": ${err.message}`);
                failed++;
            }
            
            updatedMovies.push(movie);
        });
        
        await Promise.all(promises);
        console.log(`Processed ${i + batch.length}/${movies.length}...`);
    }

    fs.writeFileSync(moviesFile, JSON.stringify(updatedMovies, null, 2));
    console.log(`Done! Downloaded: ${downloaded}. Failed: ${failed}.`);
}

run();
