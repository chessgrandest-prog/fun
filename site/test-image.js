const https = require('https');

const url = "https://lh3.googleusercontent.com/sitesv/AA5AbUB8ke1mc8uqLnBlzsXTefDS3nZ2SsCsSswb_ytRIeBkfM4_nNrpziq3VEao_Oir0BN6MPE6H6qEJB_9GEYzd_sZq6ygxus3RBQcfWyoJxSBLe4BiQIQbbs2aAJfUcfprEqCdi8I_lORJZN9Kqo0a4GHCeqo4Gn6gVl6Bp45SLeepj0aNwWZciP35GlMsvZ3hQv6DLlE4ikUuJ-d81IoIpif8Z4FgJLMuR7FFdqxhFM=w1280";

https.get(url, (res) => {
    console.log('Status Code:', res.statusCode);
    console.log('Headers:', res.headers);
}).on('error', (e) => {
    console.error(e);
});
