const https = require('https');

const url = "https://drive.google.com/thumbnail?id=1AIq4OqiMWiY9zZSayF5VID7pfTwSH6BM&sz=w800";

https.get(url, (res) => {
    console.log('Status Code:', res.statusCode);
    console.log('Headers:', res.headers);
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => console.log('Data length:', data.length));
}).on('error', (e) => {
    console.error(e);
});
