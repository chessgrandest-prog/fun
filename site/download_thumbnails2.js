const fs = require('fs');
const path = require('path');

const moviesFile = path.join(__dirname, 'movies.json');
const outDir = path.join(__dirname, 'thumbnails');

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
            let fileId = '';
            if (movie.url && movie.url.includes('/d/')) {
                fileId = movie.url.split('/d/')[1].split('/')[0];
            }

            const ext = '.jpg'; // thumbnails usually return jpeg
            const filename = safeFilename(movie.title) + ext;
            const dest = path.join(outDir, filename);
            
            if (fileId) {
                try {
                    // Check if already downloaded
                    if (!fs.existsSync(dest)) {
                        const thumbUrl = `https://drive.google.com/thumbnail?id=${fileId}&sz=w600`;
                        const res = await fetch(thumbUrl);
                        if (!res.ok) throw new Error(`Status: ${res.status}`);
                        
                        const arrayBuffer = await res.arrayBuffer();
                        const buffer = Buffer.from(arrayBuffer);
                        fs.writeFileSync(dest, buffer);
                    }
                    
                    movie.image = `https://raw.githubusercontent.com/chessgrandest-prog/fun/main/site/thumbnails/${filename}`;
                    downloaded++;
                } catch (err) {
                    console.log(`[Error] Failed to download for "${movie.title}": ${err.message}`);
                    failed++;
                }
            } else {
                console.log(`[Error] No Drive ID found for "${movie.title}"`);
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
