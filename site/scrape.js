const fs = require('fs');

async function scrapeAll() {
    const pages = [
        'https://sites.google.com/view/inkinkmath/page_2/movies/a-h',
        'https://sites.google.com/view/inkinkmath/page_2/movies/i-p',
        'https://sites.google.com/view/inkinkmath/page_2/movies/q-z',
        'https://sites.google.com/view/inkinkmath/page_2/movies/numbers-and-symbols'
    ];

    let allMovies = [];
    const seenUrls = new Set();

    function decodeHtmlEntities(str) {
        return str
            .replace(/&#39;/g, "'")
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&#34;/g, '"');
    }

    for (let pageUrl of pages) {
        console.log("Fetching", pageUrl);
        const html = await fetch(pageUrl).then(r => r.text());

        const blockRegex = /<a href="(https:\/\/drive\.google\.com\/file\/d\/[^\/]+\/view[^"]*)" target="_blank"[^>]*>[\s\S]*?<img src="(https:\/\/lh3\.googleusercontent\.com[^"]+)"[\s\S]*?<\/a>([\s\S]*?)<p [^>]*>([\s\S]*?)<\/p>/g;

        let match;
        let count = 0;
        while ((match = blockRegex.exec(html)) !== null) {
            let url = match[1];
            let thumbnail = match[2];
            let titleHtml = match[4];

            if (seenUrls.has(url)) continue;
            seenUrls.add(url);

            // Extract text from spans in the title - join with space between spans
            const spans = (titleHtml.match(/<span[^>]*>([^<]*)<\/span>/g) || [])
                .map(s => s.replace(/<[^>]+>/g, '').trim())
                .filter(s => s.length > 0);

            // Detect if spans need a space between them
            let title = '';
            for (let i = 0; i < spans.length; i++) {
                const s = spans[i];
                if (i === 0) {
                    title = s;
                } else {
                    // Add space if the previous span didn't end with space and this one doesn't start with space
                    const prevEndsWithSpace = title.endsWith(' ');
                    const currStartsWithSpace = s.startsWith(' ');
                    if (!prevEndsWithSpace && !currStartsWithSpace) {
                        title += ' ' + s;
                    } else {
                        title += s;
                    }
                }
            }
            title = decodeHtmlEntities(title.trim()) || `Movie ${allMovies.length + 1}`;

            const embedUrl = url.replace(/\/view.*$/, '/preview');
            const id = 'movie-' + (allMovies.length + 1);

            allMovies.push({ id, title, image: thumbnail, url: embedUrl });
            count++;
        }
        console.log(`  Found ${count} movies.`);
    }

    console.log(`\nTotal: ${allMovies.length} movies`);
    fs.writeFileSync('movies.json', JSON.stringify(allMovies, null, 2));
    console.log("Wrote movies.json");
    
    // Print a sample to verify
    console.log("\nSample (first 5):");
    allMovies.slice(0, 5).forEach(m => console.log(`  ${m.id}: "${m.title}"`));
}

scrapeAll().catch(console.error);
